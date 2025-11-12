// Shine.com jobs scraper - Production-ready CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '', location = '', category = '', results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 999, collectDetails = true, startUrl, startUrls, url, proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

        const toAbs = (href, base = 'https://www.shine.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (kw, loc, cat) => {
            const base = 'https://www.shine.com/job-search/';
            if (kw && loc) {
                // Use query parameters like Shine.com does: ?q=keyword&qActual=keyword
                const keywordSlug = String(kw).trim().toLowerCase().replace(/\s+/g, '-');
                const locationSlug = String(loc).trim().toLowerCase().replace(/\s+/g, '-');
                return `${base}${keywordSlug}-jobs-in-${locationSlug}`;
            } else if (kw) {
                const keywordSlug = String(kw).trim().toLowerCase().replace(/\s+/g, '-');
                return `${base}${keywordSlug}-jobs`;
            } else {
                return `${base}jobs`;
            }
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location, category));

        // Enhanced proxy configuration for anti-blocking
        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({
            ...proxyConfiguration,
            // Use residential proxies for better success rate
            groups: proxyConfiguration.groups || ['RESIDENTIAL'],
        }) : await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode: 'IN' // Use Indian proxies for Shine.com
        });

        let saved = 0;

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                salary: e.baseSalary ? `${e.baseSalary.minValue || ''}-${e.baseSalary.maxValue || ''} ${e.salaryCurrency || 'INR'}`.trim() : null,
                                experience: e.experienceRequirements ? `${Math.floor((e.experienceRequirements.monthsOfExperience || 0) / 12)}-${Math.ceil((e.experienceRequirements.monthsOfExperience || 0) / 12)} Yrs` : null,
                                location: e.jobLocation?.[0]?.address ? `${e.jobLocation[0].address.addressLocality || ''}, ${e.jobLocation[0].address.addressRegion || ''}`.trim().replace(/^,|,$/g, '') : null,
                                description_html: e.description || null,
                                skills: e.skills ? (Array.isArray(e.skills) ? e.skills : [e.skills]) : null,
                                industry: e.industry || null,
                                employment_type: e.employmentType || null,
                            };
                        }
                    }
                } catch (e) {
                    log.warning(`JSON-LD parsing error: ${e.message}`);
                }
            }
            return null;
        }

        function findJobLinks($, base) {
            const links = new Set();

            // Primary selector: job cards with links
            $('a[href*="/jobs/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                if (href.includes('/jobs/') && href.includes('shine.com')) {
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                }
            });

            // Fallback: look for job title links in specific containers
            if (links.size === 0) {
                $('h3 a, .job-title a, [class*="job"] a[href*="/jobs/"]').each((_, a) => {
                    const href = $(a).attr('href');
                    if (href && href.includes('/jobs/')) {
                        const abs = toAbs(href, base);
                        if (abs) links.add(abs);
                    }
                });
            }

            return [...links];
        }

        function findNextPage($, base, currentUrl, currentPage) {
            // Shine.com pagination: appends page number to URL
            // e.g., /job-search/admin-jobs becomes /job-search/admin-jobs-2
            try {
                const url = new URL(currentUrl);
                const pathParts = url.pathname.split('/');
                const lastPart = pathParts[pathParts.length - 1];

                // Check if already has page number
                const pageMatch = lastPart.match(/-(\d+)$/);
                if (pageMatch) {
                    const basePart = lastPart.replace(/-\d+$/, '');
                    return `${url.origin}${pathParts.slice(0, -1).join('/')}/${basePart}-${currentPage + 1}`;
                } else {
                    // First pagination
                    return `${currentUrl}-${currentPage + 1}`;
                }
            } catch (e) {
                log.warning(`Pagination URL construction error: ${e.message}`);
                return null;
            }
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 5, // Increased retries for better success
            useSessionPool: true,
            maxConcurrency: 3, // Further reduced for stealth
            requestHandlerTimeoutSecs: 120, // Increased timeout
            maxRequestsPerMinute: 20, // More conservative rate limiting
            preNavigationHooks: [
                // Enhanced anti-blocking measures based on Shine.com headers
                async ({ request, session }) => {
                    // Rotate user agents with current Chrome versions
                    const userAgents = [
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                    ];

                    // Set comprehensive headers matching Shine.com expectations
                    request.headers = {
                        ...request.headers,
                        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'max-age=0',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                        'Sec-CH-UA-Mobile': '?0',
                        'Sec-CH-UA-Platform': '"Windows"',
                        'Priority': 'u=0, i',
                    };

                    // Handle cookies properly - preserve session cookies
                    if (session && session.cookies) {
                        const cookieString = session.cookies.map(cookie =>
                            `${cookie.name}=${cookie.value}`
                        ).join('; ');
                        if (cookieString) {
                            request.headers['Cookie'] = cookieString;
                        }
                    }
                }
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST ${request.url} -> found ${links.length} links`);

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                    } else {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = links.slice(0, Math.max(0, remaining));
                        if (toPush.length) { await Dataset.pushData(toPush.map(u => ({ url: u, _source: 'shine.com' }))); saved += toPush.length; }
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const next = findNextPage($, request.url, request.url, pageNo);
                        if (next) await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;

                    try {
                        // First try JSON-LD structured data
                        const jsonLdData = extractFromJsonLd($);
                        let data = jsonLdData || {};

                        // Fallback to HTML parsing for missing fields
                        if (!data.title) {
                            data.title = $('h1').first().text().trim() ||
                                        $('[class*="job-title"]').first().text().trim() ||
                                        $('title').text().split('|')[0].trim() || null;
                        }

                        if (!data.company) {
                            data.company = $('[class*="company"], .company, [class*="employer"], .employer').first().text().trim() ||
                                          $('[class*="recruiter"]').first().text().trim() || null;
                        }

                        if (!data.description_html) {
                            const descSelectors = [
                                '[class*="job-description"]',
                                '.job-description',
                                '[class*="description"]',
                                '.description',
                                '[class*="job-detail"]',
                                '.job-detail',
                                '[class*="content"]'
                            ];

                            for (const selector of descSelectors) {
                                const desc = $(selector).first();
                                if (desc.length && desc.html()) {
                                    data.description_html = desc.html().trim();
                                    break;
                                }
                            }
                        }

                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        // Extract additional fields from HTML if not in JSON-LD
                        if (!data.location) {
                            data.location = $('[class*="location"], .location, [class*="job-location"]').first().text().trim() ||
                                           $('[class*="address"]').first().text().trim() || null;
                        }

                        if (!data.salary) {
                            data.salary = $('[class*="salary"], .salary, [class*="pay"], [class*="compensation"]').first().text().trim() || null;
                        }

                        if (!data.experience) {
                            data.experience = $('[class*="experience"], .experience, [class*="exp"]').first().text().trim() || null;
                        }

                        // Extract skills from various sources
                        if (!data.skills || data.skills.length === 0) {
                            const skills = [];
                            const skillSelectors = [
                                '[class*="skill"]',
                                '.skill',
                                '[class*="tags"]',
                                '[class*="keyword"]'
                            ];

                            skillSelectors.forEach(selector => {
                                $(selector).find('span, a, li').each((_, el) => {
                                    const skill = $(el).text().trim();
                                    if (skill && skill.length > 1 && skill.length < 50 && !skills.includes(skill)) {
                                        skills.push(skill);
                                    }
                                });
                            });

                            // Also check for skills in description
                            if (skills.length === 0 && data.description_text) {
                                const descSkills = data.description_text.match(/\b(JavaScript|Python|Java|C\+\+|React|Node\.js|SQL|AWS|Docker|Kubernetes|etc)\b/gi);
                                if (descSkills) {
                                    descSkills.forEach(skill => {
                                        if (!skills.includes(skill)) skills.push(skill);
                                    });
                                }
                            }

                            data.skills = skills.length > 0 ? skills : null;
                        }

                        // Extract additional metadata
                        if (!data.industry) {
                            data.industry = $('[class*="industry"]').first().text().trim() || null;
                        }

                        if (!data.employment_type) {
                            data.employment_type = $('[class*="employment"], [class*="job-type"]').first().text().trim() || null;
                        }

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            category: category || null,
                            location: data.location || null,
                            salary: data.salary || null,
                            experience: data.experience || null,
                            skills: data.skills || null,
                            industry: data.industry || null,
                            employment_type: data.employment_type || null,
                            date_posted: data.date_posted || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: request.url,
                            scraped_at: new Date().toISOString(),
                        };

                        await Dataset.pushData(item);
                        saved++;

                        // Add random delay between requests to be more stealthy
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

                    } catch (err) {
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                        // Continue with other jobs even if one fails
                    }
                }
            }
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
