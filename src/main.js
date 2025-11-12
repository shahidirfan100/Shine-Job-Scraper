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
            datePosted = 'anytime',
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

        const toAbs = (href, base = 'https://www.shine.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';

            // First, remove all data attributes from HTML
            html = html.replace(/ data-[^=]*="[^"]*"/g, '').replace(/ data-[^=]*='[^']*'/g, '');

            const $ = cheerioLoad(html);

            // Remove unwanted elements
            $('script, style, noscript, iframe, nav, header, footer, aside, form, input, button, select, textarea').remove();

            // Keep only text-related tags and remove their attributes (except basic formatting)
            const allowedTags = ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div'];

            // Remove attributes from allowed tags (keep only basic formatting)
            $('*').each((_, el) => {
                const tagName = el.tagName.toLowerCase();
                if (allowedTags.includes(tagName)) {
                    // Keep only basic attributes for formatting tags
                    const keepAttrs = tagName === 'a' ? ['href'] : [];
                    const attrs = el.attributes;
                    for (let i = attrs.length - 1; i >= 0; i--) {
                        const attr = attrs[i];
                        if (!keepAttrs.includes(attr.name)) {
                            $(el).removeAttr(attr.name);
                        }
                    }
                } else {
                    // Remove the element but keep its text content
                    $(el).replaceWith($(el).text());
                }
            });

            // Get the cleaned HTML and then extract text
            const cleanedHtml = $.html();
            return cheerioLoad(cleanedHtml).text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (kw, loc, cat, dateFilter) => {
            const base = 'https://www.shine.com/job-search/';
            let url;
            
            if (kw && loc) {
                // Use query parameters like Shine.com does: ?q=keyword&qActual=keyword
                const keywordSlug = String(kw).trim().toLowerCase().replace(/\s+/g, '-');
                const locationSlug = String(loc).trim().toLowerCase().replace(/\s+/g, '-');
                url = `${base}${keywordSlug}-jobs-in-${locationSlug}`;
            } else if (kw) {
                const keywordSlug = String(kw).trim().toLowerCase().replace(/\s+/g, '-');
                url = `${base}${keywordSlug}-jobs`;
            } else {
                url = `${base}jobs`;
            }
            
            // Note: Shine.com may not support date filtering in URLs
            // Date filtering will be implemented as post-processing based on date_posted field
            return url;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location, category, datePosted));

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
            maxRequestRetries: 3, // Reduced retries for faster processing
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 50, // Larger session pool for better distribution
                sessionOptions: {
                    maxAgeSecs: 1800, // 30 minutes session lifetime
                    maxUsageCount: 50, // Reuse sessions up to 50 times
                }
            },
            maxConcurrency: 10, // Increased concurrency for production performance
            requestHandlerTimeoutSecs: 90, // Optimized timeout for faster processing
            maxRequestsPerMinute: 80, // Higher rate limit with smart session management
            preNavigationHooks: [
                // Enhanced anti-blocking measures with optimized session handling
                async ({ request, session }) => {
                    // Expanded user agent rotation for better stealth
                    const userAgents = [
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
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

                    // Enhanced cookie handling with session rotation
                    if (session && session.cookies && session.cookies.length > 0) {
                        const cookieString = session.cookies
                            .filter(cookie => cookie.name && cookie.value) // Filter out invalid cookies
                            .map(cookie => `${cookie.name}=${cookie.value}`)
                            .join('; ');
                        if (cookieString) {
                            request.headers['Cookie'] = cookieString;
                        }
                    }

                    // Add slight randomization to headers for better stealth
                    const randomDelay = Math.floor(Math.random() * 100) + 50;
                    request.headers['X-Requested-With'] = Math.random() > 0.5 ? 'XMLHttpRequest' : undefined;
                }
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                        const links = findJobLinks($, request.url);
                        crawlerLog.info(`LIST ${request.url} -> found ${links.length} links (page ${pageNo})`);

                        let jobsFoundOnThisPage = 0;

                        if (collectDetails) {
                            const remaining = RESULTS_WANTED - saved;
                            const toEnqueue = links.slice(0, Math.max(0, remaining));
                            if (toEnqueue.length) {
                                await enqueueLinks({
                                    urls: toEnqueue,
                                    userData: { label: 'DETAIL' },
                                    forefront: false // Process in background for better performance
                                });
                                jobsFoundOnThisPage = toEnqueue.length;
                            }
                        } else {
                            const remaining = RESULTS_WANTED - saved;
                            const toPush = links.slice(0, Math.max(0, remaining));
                            if (toPush.length) {
                                await Dataset.pushData(toPush.map(u => ({ url: u, _source: 'shine.com' })));
                                saved += toPush.length;
                                jobsFoundOnThisPage = toPush.length;
                            }
                        }

                        // Only continue pagination if:
                        // 1. We still need more jobs (saved < RESULTS_WANTED)
                        // 2. We found jobs on this page (jobsFoundOnThisPage > 0)
                        // 3. We haven't reached MAX_PAGES
                        if (saved < RESULTS_WANTED && jobsFoundOnThisPage > 0 && pageNo < MAX_PAGES) {
                            const next = findNextPage($, request.url, request.url, pageNo);
                            if (next) {
                                await enqueueLinks({
                                    urls: [next],
                                    userData: { label: 'LIST', pageNo: pageNo + 1 },
                                    forefront: false
                                });
                            }
                        } else if (saved >= RESULTS_WANTED) {
                            // Reached desired number of jobs, stop gracefully
                            crawlerLog.info(`Reached desired number of jobs (${RESULTS_WANTED}). Stopping pagination.`);
                        } else if (jobsFoundOnThisPage === 0 && saved < RESULTS_WANTED) {
                            // No more jobs available, stop gracefully
                            crawlerLog.info(`No more jobs found on page ${pageNo}. Stopping pagination. Total jobs collected: ${saved}/${RESULTS_WANTED}`);
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

                        // Apply date filtering if specified
                        if (datePosted !== 'anytime' && data.date_posted) {
                            const jobDate = new Date(data.date_posted);
                            const now = new Date();
                            let daysDiff;

                            switch (datePosted) {
                                case '24hours':
                                    daysDiff = 1;
                                    break;
                                case '7days':
                                    daysDiff = 7;
                                    break;
                                case '30days':
                                    daysDiff = 30;
                                    break;
                                case '90days':
                                    daysDiff = 90;
                                    break;
                                default:
                                    daysDiff = 0;
                            }

                            if (daysDiff > 0) {
                                const cutoffDate = new Date(now.getTime() - (daysDiff * 24 * 60 * 60 * 1000));
                                if (jobDate < cutoffDate) {
                                    // Job is too old, skip saving it
                                    return;
                                }
                            }
                        }

                        await Dataset.pushData(item);
                        saved++;

                        // Intelligent delay based on session usage for optimal stealth-performance balance
                        const sessionUsage = request.session?.usageCount || 0;
                        const baseDelay = Math.max(200, 1000 - (sessionUsage * 50)); // Reduce delay as session matures
                        const randomDelay = Math.random() * baseDelay + 300;
                        await new Promise(resolve => setTimeout(resolve, randomDelay));

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
