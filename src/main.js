// Shine.com jobs scraper - API-first implementation (list via internal API, details via Next.js data JSON)
import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';
import fs from 'node:fs/promises';

await Actor.init();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dedupeStrings(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr || []) {
        if (typeof x !== 'string') continue;
        const t = x.replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
    }
    return out;
}

function slugify(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function collectStartUrls(input, fallbackUrl) {
    const { startUrls, startUrl, url } = input || {};
    const out = [];
    if (Array.isArray(startUrls)) out.push(...startUrls.filter(Boolean));
    if (startUrl) out.push(startUrl);
    if (url) out.push(url);
    if (!out.length && fallbackUrl) out.push(fallbackUrl);
    // Deduplicate while preserving order
    return [...new Set(out.map((u) => String(u).trim()).filter(Boolean))];
}

function buildSearchPageUrl({ keyword, location }) {
    const base = 'https://www.shine.com/job-search/';
    const kw = slugify(keyword);
    const loc = slugify(location);
    if (kw && loc) return `${base}${kw}-jobs-in-${loc}`;
    if (kw) return `${base}${kw}-jobs`;
    return `${base}jobs`;
}

function extractBuildIdFromHtml(html) {
    if (!html) return null;
    const m = String(html).match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
    return m?.[1] || null;
}

function buildApiSearchUrl({ q, qActual, loc, urlSlug, start = 0, count = 20, onlyFacet = false, extraParams = null }) {
    const u = new URL('https://www.shine.com/api/v2/search/simple/');

    // Observed in URLScan.io captures:
    // - `q` can be either a search slug (e.g. software-engineer-jobs-in-bangalore) or a raw keyword
    // - `loc` can be either a location slug or a raw location string (varies by Shine implementation)
    // - `fl` is the field list
    u.searchParams.set('q', q);
    if (loc) u.searchParams.set('loc', loc);
    u.searchParams.set('qActual', qActual ?? q);
    u.searchParams.set('_', String(Date.now()));
    u.searchParams.set(
        'fl',
        [
            'id',
            'jHF',
            'jHCD',
            'jHJ',
            'jJBL',
            'jSJ',
            'jQL',
            'jRE',
            'jRR',
            'jAC',
            'jSlug',
            'jLU',
            'jRUrl',
            'jKwd',
            'jJT',
            'jCName',
            'jCL',
            'jLoc',
            'jInd',
            'jExp',
            'jExpDate',
            'jRP',
            'jSal',
            'jPDate',
            'jJobType',
            'jEType',
            'jWM',
            'jVanc',
        ].join(',')
    );
    u.searchParams.set('show_learning_products', 'false');
    u.searchParams.set('url', urlSlug ?? q);
    // `only_facet=true` often yields facets-only responses. We want jobs.
    u.searchParams.set('only_facet', onlyFacet ? 'true' : 'false');
    u.searchParams.set('expansion', 'true');
    u.searchParams.set('expert_edge_flag', 'true');

    // Pagination: not publicly documented. Prefer `start`/`count` unless caller overrides.
    if (extraParams && typeof extraParams === 'object' && Object.keys(extraParams).length) {
        for (const [k, v] of Object.entries(extraParams)) {
            if (v === null || v === undefined || v === '') continue;
            u.searchParams.set(k, String(v));
        }
    } else {
        u.searchParams.set('start', String(start));
        u.searchParams.set('count', String(count));
    }

    return u.toString();
}

function buildNextDataUrl(buildId, absoluteUrl) {
    const u = new URL(absoluteUrl);
    const p = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
    const dataUrl = new URL(`https://www.shine.com/_next/data/${buildId}${p}.json`);
    for (const [k, v] of u.searchParams.entries()) dataUrl.searchParams.append(k, v);
    return dataUrl.toString();
}

function tryExtractJobsArray(json) {
    if (!json || typeof json !== 'object') return [];

    const directCandidates = [
        json.results,
        json.result,
        json.data,
        json.jobs,
        json.jobResults,
        json.searchResults,
        json.response,
    ];

    for (const c of directCandidates) {
        if (Array.isArray(c)) return c;
    }

    for (const c of directCandidates) {
        if (c && typeof c === 'object') {
            const arr = c.jobs || c.results || c.data || c.items;
            if (Array.isArray(arr)) return arr;
        }
    }

    // Last resort: find the first array of objects that looks like a job list.
    const queue = [{ v: json, depth: 0 }];
    while (queue.length) {
        const { v, depth } = queue.shift();
        if (!v || typeof v !== 'object' || depth > 4) continue;
        for (const val of Object.values(v)) {
            if (Array.isArray(val) && val.length && typeof val[0] === 'object') {
                const k = Object.keys(val[0]);
                if (
                    k.includes('id')
                    || k.includes('jSlug')
                    || k.includes('jLU')
                    || k.includes('jRUrl')
                    || k.some((x) => /jobid|job_id|jobId/i.test(x))
                    || k.some((x) => /jobtitle|title/i.test(x))
                    || k.some((x) => /company/i.test(x))
                ) return val;
            }
            if (val && typeof val === 'object') queue.push({ v: val, depth: depth + 1 });
        }
    }

    return [];
}

function jobUrlFromListItem(item) {
    const maybe = item?.jRUrl || item?.jLU || item?.url || item?.jobUrl;
    if (typeof maybe === 'string') {
        // Some responses contain absolute or relative job URLs.
        if (maybe.includes('/jobs/')) {
            try {
                return new URL(maybe, 'https://www.shine.com').href;
            } catch {
                // ignore
            }
        }
    }

    // Common fallback: construct Shine job URL from known fields.
    // Example pattern observed on Shine:
    // https://www.shine.com/jobs/<job-slug>/<company-slug>/<jobId>
    const id = item?.id ?? item?.jobId ?? item?.job_id;
    const jobSlug = item?.jSlug ?? item?.jobSlug ?? item?.slug;
    const companySlug = item?.jCL ?? item?.companySlug ?? (item?.jCName ? slugify(item.jCName) : null);
    if (id && jobSlug) {
        const safeJobSlug = slugify(jobSlug);
        const safeCompanySlug = companySlug ? slugify(companySlug) : null;
        if (safeCompanySlug) return `https://www.shine.com/jobs/${safeJobSlug}/${safeCompanySlug}/${id}`;
        return `https://www.shine.com/jobs/${safeJobSlug}/${id}`;
    }

    return null;
}

function pickDetailObjectFromNextData(nextData) {
    const pp = nextData?.pageProps ?? nextData?.props?.pageProps ?? nextData?.props ?? null;
    if (!pp || typeof pp !== 'object') return null;

    const keys = Object.keys(pp);
    const jobKey = keys.find((k) => k.toLowerCase().includes('job') && typeof pp[k] === 'object');
    if (jobKey && pp[jobKey]) return pp[jobKey];

    const queue = [{ v: pp, depth: 0 }];
    while (queue.length) {
        const { v, depth } = queue.shift();
        if (!v || typeof v !== 'object' || depth > 6) continue;
        const ks = Object.keys(v);
        const hasTitle = ks.some((k) => /title|jobtitle|name/i.test(k));
        const hasDesc = ks.some((k) => /desc|description|jobdesc/i.test(k));
        if (hasTitle && hasDesc) return v;
        for (const val of Object.values(v)) {
            if (val && typeof val === 'object') queue.push({ v: val, depth: depth + 1 });
        }
    }
    // Fallback: return pageProps as-is so downstream extraction can still attempt to find fields.
    return pp;
}

function normalizeSkills(skills) {
    if (!skills) return null;
    if (Array.isArray(skills)) return skills.filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
    if (typeof skills === 'string') {
        const parts = skills.split(/,|\||\n/).map((s) => s.trim()).filter(Boolean);
        return parts.length ? parts : null;
    }
    return null;
}

function normalizeLocation(loc) {
    if (!loc) return null;
    if (typeof loc === 'string') {
        const s = loc.replace(/\s+/g, ' ').trim();
        return s || null;
    }
    if (Array.isArray(loc)) {
        const parts = loc.map(normalizeLocation).filter(Boolean);
        const uniq = dedupeStrings(parts);
        if (!uniq.length) return null;
        return uniq.join(', ');
    }
    if (typeof loc === 'object') {
        // JSON-LD JobPosting: jobLocation can be Place or array of Place
        const addr = loc.address || loc.Address || null;
        if (addr && typeof addr === 'object') {
            const fields = dedupeStrings([
                addr.addressLocality,
                addr.addressRegion,
                addr.addressCountry,
            ].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()));
            if (fields.length) return fields.join(', ');
        }
        if (typeof loc.name === 'string' && loc.name.trim()) return loc.name.trim();
        const fields = dedupeStrings([
            loc.addressLocality,
            loc.addressRegion,
            loc.addressCountry,
        ].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()));
        if (fields.length) return fields.join(', ');
    }
    return null;
}

function normalizeSalary(s) {
    if (!s) return null;
    if (typeof s === 'string') return s.trim() || null;
    if (typeof s === 'number') return String(s);
    if (typeof s !== 'object') return null;

    // JSON-LD baseSalary often:
    // { "@type":"MonetaryAmount", "currency":"INR", "value": { "@type":"QuantitativeValue", "minValue":..., "maxValue":..., "unitText":"MONTH" } }
    const currency = s.currency || s.currencyCode || s?.value?.currency || null;
    const v = s.value || s.salary || s.amount || null;
    if (typeof v === 'number') return `${currency ? `${currency} ` : ''}${v}`.trim();
    if (typeof v === 'string') return `${currency ? `${currency} ` : ''}${v}`.trim();

    if (v && typeof v === 'object') {
        const unit = v.unitText || v.unit || s.unitText || null;
        const min = v.minValue ?? v.min ?? v.low ?? null;
        const max = v.maxValue ?? v.max ?? v.high ?? null;
        const val = v.value ?? null;
        const unitSuffix = unit ? ` / ${String(unit).trim()}` : '';
        if (min !== null && max !== null) return `${currency ? `${currency} ` : ''}${min}-${max}${unitSuffix}`.trim();
        if (val !== null) return `${currency ? `${currency} ` : ''}${val}${unitSuffix}`.trim();
    }

    return null;
}

function normalizeExperience(exp) {
    if (!exp) return null;
    if (typeof exp === 'string') return exp.trim() || null;
    if (typeof exp === 'number') return `${exp} years`;
    if (typeof exp !== 'object') return null;

    const v = exp.value || exp.experience || exp.years || exp.months || null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return `${v} years`;

    const min = exp.minValue ?? exp.min ?? exp.low ?? null;
    const max = exp.maxValue ?? exp.max ?? exp.high ?? null;
    if (min !== null && max !== null) return `${min}-${max} years`;

    // Try nested common keys
    const months = exp.monthsOfExperience ?? exp.months ?? null;
    if (typeof months === 'number') return `${months} months`;

    return null;
}

function normalizeSkillsFromList(listItem, companyName) {
    const raw = listItem?.jHF ?? null;
    const parsed = normalizeSkills(raw);
    if (!parsed || !parsed.length) return null;

    // Heuristic: if Shine returns company name in jHF, drop it.
    if (companyName) {
        const c = String(companyName).trim().toLowerCase();
        const cleaned = parsed.filter((x) => x && x.trim().toLowerCase() !== c);
        return cleaned.length ? cleaned : null;
    }
    return parsed;
}

function findNestedString(obj, predicate, maxDepth = 6) {
    const queue = [{ v: obj, depth: 0 }];
    while (queue.length) {
        const { v, depth } = queue.shift();
        if (v === null || v === undefined || depth > maxDepth) continue;
        if (typeof v === 'string') {
            if (predicate(v)) return v;
            continue;
        }
        if (Array.isArray(v)) {
            for (const x of v) queue.push({ v: x, depth: depth + 1 });
            continue;
        }
        if (typeof v === 'object') {
            for (const x of Object.values(v)) queue.push({ v: x, depth: depth + 1 });
        }
    }
    return null;
}

function findNestedValueByKey(obj, keyRegex, maxDepth = 6) {
    const queue = [{ v: obj, depth: 0 }];
    while (queue.length) {
        const { v, depth } = queue.shift();
        if (!v || typeof v !== 'object' || depth > maxDepth) continue;
        for (const [k, val] of Object.entries(v)) {
            if (keyRegex.test(k)) return val;
            if (val && typeof val === 'object') queue.push({ v: val, depth: depth + 1 });
        }
    }
    return null;
}

function extractNextDataFromHtml(html) {
    const s = String(html || '');
    const m = s.match(/<script[^>]+id=['"]__NEXT_DATA__['"][^>]*>([\s\S]*?)<\/script>/i);
    if (!m?.[1]) return null;
    try {
        return JSON.parse(m[1]);
    } catch {
        return null;
    }
}

function extractJsonLdJobPostingFromHtml(html) {
    const s = String(html || '');
    const out = [];
    const re = /<script[^>]+type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
        const raw = (m[1] || '').trim();
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) out.push(...parsed);
            else out.push(parsed);
        } catch {
            // ignore invalid JSON-LD blocks
        }
    }

    for (const obj of out) {
        if (!obj || typeof obj !== 'object') continue;
        const t = obj['@type'];
        const types = Array.isArray(t) ? t : (t ? [t] : []);
        if (types.includes('JobPosting')) return obj;
        // Sometimes JobPosting is nested in @graph
        if (Array.isArray(obj['@graph'])) {
            const hit = obj['@graph'].find((x) => x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].includes('JobPosting'))));
            if (hit) return hit;
        }
    }
    return null;
}

function normalizeDescriptionFromAny(v) {
    if (!v) return null;
    if (typeof v === 'string') {
        const s = v.trim();
        return s || null;
    }
    if (Array.isArray(v)) {
        const parts = v.map(normalizeDescriptionFromAny).filter(Boolean);
        if (!parts.length) return null;
        return parts.join('\n');
    }
    if (typeof v === 'object') {
        const pick = v.html || v.description || v.text || v.value || v.content;
        return normalizeDescriptionFromAny(pick);
    }
    return null;
}

function isProbablyEmailOnly(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    if (t.length > 120) return false;
    if (/\s/.test(t)) return false;
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(t);
}

function looksLikeRealDescription(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    if (isProbablyEmailOnly(t)) return false;
    if (/<(p|br|ul|ol|li|div|span)\b/i.test(t)) return true;
    // Require a minimum word count to avoid saving random short strings.
    const words = t.split(/\s+/).filter(Boolean);
    return words.length >= 20 && t.length >= 120;
}

function mapDetailToDataset(detail, fallback, url) {
    const jsonLd = (detail && typeof detail === 'object' && detail.__jsonLd && typeof detail.__jsonLd === 'object')
        ? detail.__jsonLd
        : null;

    const title = detail?.title ?? detail?.jobTitle ?? detail?.name ?? jsonLd?.title ?? fallback?.jJT ?? null;
    const company = detail?.company
        ?? detail?.companyName
        ?? detail?.hiringOrganization?.name
        ?? jsonLd?.hiringOrganization?.name
        ?? jsonLd?.name
        ?? fallback?.jCName
        ?? null;
    const location = normalizeLocation(detail?.location ?? detail?.jobLocation ?? detail?.loc)
        ?? normalizeLocation(jsonLd?.jobLocation ?? jsonLd?.location)
        ?? (fallback?.jLoc ? String(fallback.jLoc).trim() : null);
    const salary = normalizeSalary(detail?.salary ?? detail?.ctc ?? detail?.compensation)
        ?? normalizeSalary(jsonLd?.baseSalary)
        ?? (fallback?.jSal ? String(fallback.jSal).trim() : null);
    const experience = normalizeExperience(detail?.experience ?? detail?.exp)
        ?? normalizeExperience(jsonLd?.experienceRequirements)
        ?? (fallback?.jExp ? String(fallback.jExp).trim() : null);
    const industry = detail?.industry ?? jsonLd?.industry ?? fallback?.jInd ?? null;
    const employmentType = detail?.employment_type ?? detail?.employmentType ?? detail?.jobType ?? jsonLd?.employmentType ?? fallback?.jJobType ?? fallback?.jEType ?? null;
    const datePosted = detail?.date_posted ?? detail?.datePosted ?? detail?.postedDate ?? jsonLd?.datePosted ?? fallback?.jPDate ?? null;
    let descriptionHtml = detail?.description_html ?? detail?.descriptionHtml ?? detail?.description ?? detail?.jobDescription ?? null;
    if (!descriptionHtml && jsonLd?.description) descriptionHtml = jsonLd.description;
    if (!descriptionHtml && detail && typeof detail === 'object') {
        const byKey = findNestedValueByKey(detail, /desc|description|jobdesc|jd/i);
        if (typeof byKey === 'string') descriptionHtml = byKey;
        else if (Array.isArray(byKey)) {
            const parts = byKey.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
            if (parts.length) descriptionHtml = parts.join('\n');
        } else if (byKey && typeof byKey === 'object') {
            const maybeHtml = byKey.html || byKey.description || byKey.text || byKey.value;
            if (typeof maybeHtml === 'string' && maybeHtml.trim()) descriptionHtml = maybeHtml.trim();
        }
    }
    // If detail isn't present (collectDetails=false) try to use list API fields.
    if (!descriptionHtml && fallback && typeof fallback === 'object') {
        const cand =
            normalizeDescriptionFromAny(fallback.jHCD)
            || normalizeDescriptionFromAny(fallback.jHJ)
            || normalizeDescriptionFromAny(fallback.jSJ)
            || normalizeDescriptionFromAny(fallback.jJBL)
            || normalizeDescriptionFromAny(fallback.jRE)
            || normalizeDescriptionFromAny(fallback.jRR)
            || null;
        if (cand && looksLikeRealDescription(cand)) descriptionHtml = cand;
    }
    if (!descriptionHtml && detail && typeof detail === 'object') {
        // Try to locate a description-ish nested field (HTML or long text).
        descriptionHtml = findNestedString(
            detail,
            (s) => (/<(p|br|ul|ol|li|div|span)\b/i.test(s) && s.length > 100) || s.length > 600
        );
    }
    const descriptionText = typeof detail?.description_text === 'string'
        ? detail.description_text
        : (typeof descriptionHtml === 'string' ? String(descriptionHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);
    let skills = normalizeSkills(detail?.skills ?? detail?.keySkills ?? detail?.skill);
    if (!skills && jsonLd) {
        skills = normalizeSkills(jsonLd.skills ?? jsonLd.skill ?? jsonLd.qualifications);
    }
    if (!skills) {
        skills = normalizeSkillsFromList(fallback, company);
    }
    if (!skills && detail && typeof detail === 'object') {
        const nestedSkills = findNestedValueByKey(detail, /skill/i);
        skills = normalizeSkills(nestedSkills);
    }
    if (skills && company) {
        const c = String(company).trim().toLowerCase();
        skills = skills.map((x) => String(x).trim()).filter(Boolean).filter((x) => x.toLowerCase() !== c);
        if (!skills.length) skills = null;
    }

    return {
        title: title ? String(title).trim() : null,
        company: company ? String(company).trim() : null,
        location: location ? String(location).trim() : null,
        salary: salary ? String(salary).trim() : null,
        experience: experience ? String(experience).trim() : null,
        skills,
        industry: industry ? String(industry).trim() : null,
        employment_type: employmentType ? String(employmentType).trim() : null,
        date_posted: datePosted ? String(datePosted).trim() : null,
        description_html: descriptionHtml ? String(descriptionHtml) : null,
        description_text: descriptionText || null,
        url,
        job_id: fallback?.id ?? null,
        job_slug: fallback?.jSlug ?? null,
        company_slug: fallback?.jCL ?? (fallback?.jCName ? slugify(fallback.jCName) : null),
        scraped_at: new Date().toISOString(),
    };
}

async function mapWithConcurrency(items, concurrency, fn) {
    const results = new Array(items.length);
    let idx = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
        while (true) {
            const myIdx = idx++;
            if (myIdx >= items.length) return;
            results[myIdx] = await fn(items[myIdx], myIdx);
        }
    });
    await Promise.all(workers);
    return results;
}

async function forEachWithConcurrency(items, concurrency, fn) {
    let idx = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
        while (true) {
            const myIdx = idx++;
            if (myIdx >= items.length) return;
            await fn(items[myIdx], myIdx);
        }
    });
    await Promise.all(workers);
}

async function fetchText(url, { proxyUrl, headers, timeoutMs = 60000 }) {
    const opts = {
        headers,
        timeout: { request: timeoutMs },
        retry: { limit: 3 },
        throwHttpErrors: false,
        followRedirect: true,
    };
    if (typeof proxyUrl === 'string' && proxyUrl.trim()) opts.proxyUrl = proxyUrl;

    const res = await gotScraping.get(url, opts);

    if (res.statusCode >= 400) {
        const body = typeof res.body === 'string' ? res.body : Buffer.from(res.body || '').toString('utf8');
        const title = body.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
        const hint = title ? ` (${title})` : '';
        throw new Error(`HTTP ${res.statusCode} for ${url}${hint}`);
    }

    return typeof res.body === 'string' ? res.body : Buffer.from(res.body || '').toString('utf8');
}

async function fetchJson(url, { proxyUrl, headers, timeoutMs = 60000 }) {
    const text = await fetchText(url, { proxyUrl, headers, timeoutMs });
    try {
        return JSON.parse(text);
    } catch (e) {
        const snippet = text.slice(0, 250);
        throw new Error(`JSON parse failed for ${url}: ${e.message}. Body starts with: ${JSON.stringify(snippet)}`);
    }
}

async function loadInputFallback(input) {
    const hasMeaningfulInput = !!(
        input
        && typeof input === 'object'
        && (
            (typeof input.keyword === 'string' && input.keyword.trim())
            || (typeof input.location === 'string' && input.location.trim())
            || (typeof input.startUrl === 'string' && input.startUrl.trim())
            || (typeof input.url === 'string' && input.url.trim())
            || (Array.isArray(input.startUrls) && input.startUrls.length)
        )
    );
    if (hasMeaningfulInput) return input;
    try {
        const raw = await fs.readFile('INPUT.json', 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            log.info('Loaded input from local INPUT.json fallback.');
            return parsed;
        }
    } catch {
        // ignore
    }
    return input || {};
}

async function main() {
    const input = await loadInputFallback((await Actor.getInput()) || {});
    const {
        keyword = '',
        location = '',
        results_wanted: RESULTS_WANTED_RAW = 100,
        max_pages: MAX_PAGES_RAW = 20,
        datePosted = 'anytime',
        collectDetails = true,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
    const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;
    const pageSize = 20; // Keep stable; Shine behaves best with 20.

    const searchUrls = collectStartUrls(input, buildSearchPageUrl({ keyword, location }));

    const headerGenerator = new HeaderGenerator({
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 132 }],
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos'],
        locales: ['en-US', 'en'],
    });

    const isAtHome = typeof Actor.isAtHome === 'function'
        ? Actor.isAtHome()
        : (process.env.APIFY_IS_AT_HOME === '1' || process.env.APIFY_IS_AT_HOME === 'true');

    // Local runs: do not use Apify Proxy unless the user explicitly configures it.
    // Platform runs: auto-enable Apify Proxy by default (unless user disables it).
    let proxyConf = null;
    if (proxyConfiguration && proxyConfiguration.useApifyProxy === false) {
        proxyConf = null;
        log.debug('Proxy disabled by input.proxyConfiguration.useApifyProxy=false');
    } else if (proxyConfiguration) {
        proxyConf = await Actor.createProxyConfiguration({
            ...proxyConfiguration,
            groups: proxyConfiguration.groups || proxyConfiguration.apifyProxyGroups || ['RESIDENTIAL'],
        });
    } else if (isAtHome) {
        proxyConf = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'IN' });
    } else {
        proxyConf = null;
        log.debug('Local run detected: running without Apify Proxy (set proxyConfiguration to enable).');
    }

    const makeProxyUrl = async () => {
        if (!proxyConf) return undefined;
        try {
            // In Apify SDK v3, ProxyConfiguration.newUrl() is async.
            return await proxyConf.newUrl();
        } catch {
            return undefined;
        }
    };

    const baseHeaders = () => {
        const h = headerGenerator.getHeaders();
        return {
            ...h,
            'accept-language': h['accept-language'] || 'en-US,en;q=0.9',
            dnt: '1',
            connection: 'keep-alive',
        };
    };

    // Bootstrap buildId once (used for Next.js data JSON detail fetch).
    let buildId = null;
    // We still try to discover buildId because some runs may allow fast Next.js data JSON.
    if (collectDetails) {
        for (const candidateUrl of searchUrls) {
            try {
                const proxyUrl = await makeProxyUrl();
                const html = await fetchText(candidateUrl, {
                    proxyUrl,
                    headers: {
                        ...baseHeaders(),
                        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        referer: 'https://www.shine.com/',
                        'upgrade-insecure-requests': '1',
                    },
                });
                buildId = extractBuildIdFromHtml(html);
                if (buildId) {
                    log.debug(`Discovered Next.js buildId: ${buildId}`);
                    break;
                }
            } catch (e) {
                log.warning(`Bootstrap failed for ${candidateUrl}: ${e.message}`);
            }
        }
        if (!buildId) log.debug('Could not discover Next.js buildId from bootstrap HTML. Detail JSON fetch may be unavailable.');
    }

    const seen = new Set();
    let saved = 0;
    const samples = [];
    const dataset = await Actor.openDataset();
    const detailConcurrency = isAtHome ? 20 : 8;
    let nextDataGloballyEnabled = false;
    let nextDataGloballyDecided = false;

    for (const searchPageUrl of searchUrls) {
        if (saved >= RESULTS_WANTED) break;

        // Derive q/loc slugs from the search page URL.
        let qSlug = null;
        let locSlug = null;
        let qQuery = null;
        let locQuery = null;
        try {
            const u = new URL(searchPageUrl);
            const parts = u.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('job-search');
            if (idx >= 0 && parts[idx + 1]) qSlug = parts[idx + 1];
            qQuery = u.searchParams.get('q') || null;
            locQuery = u.searchParams.get('loc') || null;
            locSlug = locQuery || null;
            if (!locSlug && qSlug && qSlug.includes('-jobs-in-')) locSlug = qSlug.split('-jobs-in-').pop();
        } catch {
            // ignore
        }

        if (!qSlug) {
            qSlug = slugify(keyword) && slugify(location)
                ? `${slugify(keyword)}-jobs-in-${slugify(location)}`
                : (slugify(keyword) ? `${slugify(keyword)}-jobs` : 'jobs');
        }
        if (!locSlug) locSlug = slugify(location) || null;

        log.info(`Search page: ${searchPageUrl}`);
        log.debug(`API query: q=${qSlug}${locSlug ? ` loc=${locSlug}` : ''}`);

        let apiQ = qSlug;
        let apiLoc = locSlug;
        let apiQActual = qSlug;
        const apiUrlSlug = qSlug;

        for (let pageNo = 1; pageNo <= MAX_PAGES && saved < RESULTS_WANTED; pageNo++) {
            const start = (pageNo - 1) * pageSize;
            const proxyUrl = await makeProxyUrl();

            let json;
            let usedApiUrl;
            try {
                const candidates = [
                    buildApiSearchUrl({
                        q: apiQ,
                        qActual: apiQActual,
                        loc: apiLoc,
                        urlSlug: apiUrlSlug,
                        start,
                        count: pageSize,
                        onlyFacet: false,
                    }),
                    // Alternate pagination patterns.
                    buildApiSearchUrl({
                        q: apiQ,
                        qActual: apiQActual,
                        loc: apiLoc,
                        urlSlug: apiUrlSlug,
                        onlyFacet: false,
                        extraParams: { page: pageNo, count: pageSize },
                    }),
                    buildApiSearchUrl({
                        q: apiQ,
                        qActual: apiQActual,
                        loc: apiLoc,
                        urlSlug: apiUrlSlug,
                        onlyFacet: false,
                        extraParams: { page: pageNo, pageSize },
                    }),
                    buildApiSearchUrl({
                        q: apiQ,
                        qActual: apiQActual,
                        loc: apiLoc,
                        urlSlug: apiUrlSlug,
                        onlyFacet: false,
                        extraParams: { pageNo, count: pageSize },
                    }),
                    buildApiSearchUrl({
                        q: apiQ,
                        qActual: apiQActual,
                        loc: apiLoc,
                        urlSlug: apiUrlSlug,
                        onlyFacet: false,
                        extraParams: { offset: start, limit: pageSize },
                    }),
                ];

                for (const candidateUrl of candidates) {
                    const candidateJson = await fetchJson(candidateUrl, {
                        proxyUrl,
                        headers: {
                            ...baseHeaders(),
                            accept: 'application/json, text/plain, */*',
                            referer: searchPageUrl,
                            origin: 'https://www.shine.com',
                            'x-requested-with': 'XMLHttpRequest',
                        },
                    });

                    const candidateJobs = tryExtractJobsArray(candidateJson);
                    if (!candidateJobs.length) {
                        continue;
                    }

                    // Check if this candidate yields any *new* jobs after dedupe.
                    const hasAnyNew = candidateJobs.some((it) => {
                        const jobUrl = jobUrlFromListItem(it);
                        const key = jobUrl || String(it?.id || '');
                        return key && !seen.has(key);
                    });
                    if (!hasAnyNew && pageNo > 1) continue;

                    json = candidateJson;
                    usedApiUrl = candidateUrl;
                    break;
                }

                if (!json) {
                    // Fall back to the primary URL response so we can log something.
                    const primaryUrl = candidates[0];
                    json = await fetchJson(primaryUrl, {
                        proxyUrl,
                        headers: {
                            ...baseHeaders(),
                            accept: 'application/json, text/plain, */*',
                            referer: searchPageUrl,
                            origin: 'https://www.shine.com',
                            'x-requested-with': 'XMLHttpRequest',
                        },
                    });
                    usedApiUrl = primaryUrl;
                }
            } catch (e) {
                log.error(`List API failed on page ${pageNo}: ${e.message}`);
                break;
            }

            let jobs = tryExtractJobsArray(json);

            // If we get a JSON response but no jobs, try an alternate query style:
            // some Shine variants expect raw keyword/location rather than the SEO slug.
            if (pageNo === 1 && jobs.length === 0) {
                const altQ = qQuery || keyword || null;
                const altLoc = locQuery || location || apiLoc || null;
                if (altQ && (altQ !== apiQ || altLoc !== apiLoc)) {
                    const altApiUrl = buildApiSearchUrl({
                        q: altQ,
                        qActual: altQ,
                        loc: altLoc,
                        urlSlug: apiUrlSlug,
                        start,
                        count: pageSize,
                        onlyFacet: false,
                    });

                    try {
                        const altJson = await fetchJson(altApiUrl, {
                            proxyUrl,
                            headers: {
                                ...baseHeaders(),
                                accept: 'application/json, text/plain, */*',
                                referer: searchPageUrl,
                                origin: 'https://www.shine.com',
                                'x-requested-with': 'XMLHttpRequest',
                            },
                        });

                        const altJobs = tryExtractJobsArray(altJson);

                        if (altJobs.length) {
                            log.info(`Primary API returned 0 jobs; switching to alternate query mode (q=${JSON.stringify(altQ)} loc=${JSON.stringify(altLoc)}).`);
                            apiQ = altQ;
                            apiQActual = altQ;
                            apiLoc = altLoc;
                            json = altJson;
                            jobs = altJobs;
                        }
                    } catch (e) {
                        log.warning(`Alternate list API request failed: ${e.message}`);
                    }
                }
            }
            log.debug(`API page ${pageNo}: extracted ${jobs.length} jobs (start=${start}, count=${pageSize}).`);
            if (!jobs.length) break;

            if (pageNo === 1 && jobs.length && saved === 0) {
                const first = jobs[0];
                if (first && typeof first === 'object') {
                    const sample = {
                        keys: Object.keys(first).slice(0, 40),
                        id: first.id ?? null,
                        jJT: first.jJT ?? null,
                        jLoc: first.jLoc ?? null,
                        jHF_type: typeof first.jHF,
                        jHF_len: typeof first.jHF === 'string' ? first.jHF.length : (Array.isArray(first.jHF) ? first.jHF.length : null),
                        jHCD_type: typeof first.jHCD,
                        jHCD_len: typeof first.jHCD === 'string' ? first.jHCD.length : null,
                        jHJ_type: typeof first.jHJ,
                        jJBL_type: typeof first.jJBL,
                    };
                    log.debug(`List item sample: ${JSON.stringify(sample)}`);
                }
            }

            const batch = [];
            for (const it of jobs) {
                const jobUrl = jobUrlFromListItem(it);
                const key = jobUrl || String(it?.id || '');
                if (!key || seen.has(key)) continue;
                seen.add(key);
                batch.push({ it, jobUrl });
                if (saved + batch.length >= RESULTS_WANTED) break;
            }

            if (!batch.length) {
                log.info(`API page ${pageNo}: no new jobs after dedupe, stopping.`);
                break;
            }

            if (!collectDetails) {
                const before = saved;
                const rows = batch.map(({ it, jobUrl }) => mapDetailToDataset(null, it, jobUrl || null));
                await dataset.pushData(rows);
                saved += rows.length;
                log.info(`Pushed ${saved - before} items. Total: ${saved}/${RESULTS_WANTED}.`);
                continue;
            }

            const remaining = RESULTS_WANTED - saved;
            const toProcess = batch.slice(0, Math.max(0, remaining));

            const detailStats = {
                prefetched: 0,
                nextDataOk: 0,
                nextDataFail: 0,
                htmlOk: 0,
                htmlJsonLd: 0,
                htmlNextData: 0,
                htmlNoStructured: 0,
                errors: 0,
            };

            // Decide (once per run) whether Next.js data JSON is worth using.
            // If it mostly 404s (common on Shine), we skip it and go straight to HTML JSON-LD/__NEXT_DATA__ (fewer requests).
            const prefetched = new Map();
            if (collectDetails && buildId && !nextDataGloballyDecided) {
                const probeUrl = toProcess.find((x) => x.jobUrl)?.jobUrl || null;
                if (probeUrl) {
                    const px = await makeProxyUrl();
                    try {
                        const nextUrl = buildNextDataUrl(buildId, probeUrl);
                        const nextData = await fetchJson(nextUrl, {
                            proxyUrl: px,
                            timeoutMs: 25000,
                            headers: {
                                ...baseHeaders(),
                                accept: 'application/json, text/plain, */*',
                                referer: probeUrl,
                                origin: 'https://www.shine.com',
                                'x-requested-with': 'XMLHttpRequest',
                            },
                        });
                        const detailObj = pickDetailObjectFromNextData(nextData);
                        nextDataGloballyEnabled = !!detailObj;
                        nextDataGloballyDecided = true;
                        if (nextDataGloballyEnabled) {
                            prefetched.set(probeUrl, detailObj);
                            detailStats.prefetched++;
                            log.debug('Detail mode: Next.js data JSON enabled (fast path).');
                        } else {
                            log.debug('Detail mode: Next.js data JSON returned no usable job object; using HTML details.');
                        }
                    } catch (e) {
                        nextDataGloballyEnabled = false;
                        nextDataGloballyDecided = true;
                        // 404s are expected here; avoid per-job warning spam.
                        log.debug(`Detail mode: Next.js data JSON unavailable (${e.message}); using HTML details.`);
                    }
                }
            }

            const before = saved;
            await forEachWithConcurrency(toProcess, detailConcurrency, async ({ it, jobUrl }) => {
                if (!jobUrl) {
                    const row = mapDetailToDataset(null, it, null);
                    await dataset.pushData(row);
                    saved++;
                    if (samples.length < 3) samples.push(row);
                    return;
                }

                const px = await makeProxyUrl();
                let nextJsonError = null;

                try {
                    let detailObj = prefetched.get(jobUrl) || null;
                    if (detailObj) {
                        detailStats.nextDataOk++;
                    } else if (nextDataGloballyEnabled && buildId) {
                        const nextUrl = buildNextDataUrl(buildId, jobUrl);
                        try {
                            const nextData = await fetchJson(nextUrl, {
                                proxyUrl: px,
                                timeoutMs: 25000,
                                headers: {
                                    ...baseHeaders(),
                                    accept: 'application/json, text/plain, */*',
                                    referer: jobUrl,
                                    origin: 'https://www.shine.com',
                                    'x-requested-with': 'XMLHttpRequest',
                                },
                            });
                            detailObj = pickDetailObjectFromNextData(nextData);
                            if (detailObj) detailStats.nextDataOk++;
                            else detailStats.nextDataFail++;
                        } catch (e) {
                            nextJsonError = e;
                            detailStats.nextDataFail++;
                        }
                    }

                    // HTML fallback (always enabled, more complete, avoids _next/data 404 spam).
                    if (!detailObj) {
                        const html = await fetchText(jobUrl, {
                            proxyUrl: px,
                            timeoutMs: 60000,
                            headers: {
                                ...baseHeaders(),
                                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                                referer: searchPageUrl,
                                'upgrade-insecure-requests': '1',
                            },
                        });

                        const jsonLd = extractJsonLdJobPostingFromHtml(html);
                        const nextFromHtml = extractNextDataFromHtml(html);
                        const nextDetail = nextFromHtml ? pickDetailObjectFromNextData(nextFromHtml) : null;

                        if (nextFromHtml?.buildId && nextFromHtml.buildId !== buildId) buildId = nextFromHtml.buildId;

                        if (nextDetail && typeof nextDetail === 'object' && jsonLd && typeof jsonLd === 'object') {
                            // Combine: Next data is often richer (skills/description), JSON-LD is more standardized (company/location).
                            detailObj = { ...nextDetail, __jsonLd: jsonLd };
                            detailStats.htmlNextData++;
                            detailStats.htmlJsonLd++;
                        } else if (nextDetail) {
                            detailObj = nextDetail;
                            detailStats.htmlNextData++;
                        } else if (jsonLd) {
                            detailObj = jsonLd;
                            detailStats.htmlJsonLd++;
                        }

                        if (detailObj) detailStats.htmlOk++;
                        else detailStats.htmlNoStructured++;
                    }

                    const row = mapDetailToDataset(detailObj, it, jobUrl);
                    await dataset.pushData(row);
                    saved++;
                    if (samples.length < 3) samples.push(row);
                } catch (e) {
                    detailStats.errors++;
                    const extra = (typeof nextJsonError?.message === 'string') ? ` (next data JSON error: ${nextJsonError.message})` : '';
                    log.warning(`Detail fetch failed for ${jobUrl}: ${e.message}${extra}`);
                    const row = mapDetailToDataset(null, it, jobUrl);
                    await dataset.pushData(row);
                    saved++;
                    if (samples.length < 3) samples.push(row);
                } finally {
                    // Small jitter to reduce block probability while keeping speed high.
                    await sleep(15 + Math.random() * 45);
                }
            });

            log.info(`Pushed ${saved - before} items. Total: ${saved}/${RESULTS_WANTED}.`);
            log.debug(
                `Details stats. nextData(ok=${detailStats.nextDataOk}, fail=${detailStats.nextDataFail}) html(ok=${detailStats.htmlOk}, jsonLd=${detailStats.htmlJsonLd}, nextData=${detailStats.htmlNextData}, none=${detailStats.htmlNoStructured}) errors=${detailStats.errors}.`
            );

            if (datePosted !== 'anytime') {
                log.debug('datePosted filtering is not strictly enforced in API mode (depends on the fields returned by Shine).');
            }

            if (collectDetails) {
                await sleep(200 + Math.random() * 400);
            } else {
                await sleep(Math.random() * 200);
            }
        }
    }

    if (samples.length) {
        log.debug(`Sample items: ${JSON.stringify(samples, null, 2).slice(0, 2000)}`);
    }
    log.info(`Finished. Saved ${saved} items.`);
}

try {
    await main();
} finally {
    await Actor.exit();
}
