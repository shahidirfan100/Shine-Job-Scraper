# Shine.com Jobs Scraper

Extract comprehensive job listings from Shine.com, India's premier job search platform. Collect detailed job data including salaries, skills, company information, and descriptions at scale. Perfect for recruitment agencies, HR analytics, and job market research.

## Features

- **Complete Job Data** — Extract titles, companies, locations, salaries, and full descriptions
- **Advanced Filtering** — Search by keywords, locations, and posting dates
- **Skill Extraction** — Capture required skills and qualifications automatically
- **Pagination Support** — Handle large result sets with automatic page navigation
- **Structured Output** — Clean JSON data ready for analysis and integration

## Use Cases

### Recruitment Intelligence
Identify top hiring companies and track job market trends. Analyze skill demands and salary ranges across industries.

### Market Research
Gather comprehensive job data for workforce planning and talent acquisition strategies. Monitor industry growth and hiring patterns.

### Competitive Analysis
Track competitor hiring activities and talent acquisition strategies. Understand market positioning and recruitment effectiveness.

### Career Planning
Research job requirements, experience levels, and skill gaps in target industries. Make informed career decisions with real market data.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Specific Shine.com search URL to start scraping |
| `keyword` | String | No | — | Job search keywords (e.g., 'software engineer') |
| `location` | String | No | — | Location filter (e.g., 'Bangalore', 'Mumbai') |
| `collectDetails` | Boolean | No | `true` | Whether to fetch detailed job descriptions |
| `datePosted` | String | No | `"anytime"` | Filter by posting date (anytime, 24hours, 7days, 30days, 90days) |
| `results_wanted` | Integer | No | `100` | Maximum number of jobs to collect |
| `max_pages` | Integer | No | `20` | Maximum search result pages to process |
| `proxyConfiguration` | Object | No | Residential proxies | Proxy settings for reliable scraping |

## Output Data

Each job listing in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job position title |
| `company` | String | Hiring company name |
| `location` | String | Job location |
| `salary` | String | Salary range or information |
| `experience` | String | Required experience level |
| `skills` | Array | Required skills and qualifications |
| `industry` | String | Industry classification |
| `employment_type` | String | Full-time, part-time, etc. |
| `date_posted` | String | When the job was posted |
| `url` | String | Direct link to the job posting |
| `scraped_at` | String | Timestamp of data collection |

## Usage Examples

### Basic Job Search

Extract software engineering jobs in Bangalore:

```json
{
    "keyword": "software engineer",
    "location": "Bangalore",
    "results_wanted": 50
}
```

### Recent Postings Only

Find jobs posted in the last 7 days:

```json
{
    "keyword": "data analyst",
    "datePosted": "7days",
    "results_wanted": 100
}
```

### Custom Search URL

Scrape from a specific Shine.com search page:

```json
{
    "startUrl": "https://www.shine.com/job-search/data-scientist-jobs-in-mumbai",
    "collectDetails": true
}
```

## Sample Output

```json
{
    "title": "Senior Software Engineer",
    "company": "Tech Solutions Pvt Ltd",
    "location": "Bangalore, Karnataka",
    "salary": "₹8,00,000 - ₹15,00,000 P.A.",
    "experience": "3 to 8 years",
    "skills": ["Java", "Spring Boot", "Microservices", "AWS"],
    "industry": "IT Services & Consulting",
    "employment_type": "Full Time",
    "date_posted": "2024-02-10",
    "url": "https://www.shine.com/jobs/senior-software-engineer/12345",
    "scraped_at": "2024-02-15T10:30:00Z"
}
```

## Tips for Best Results

### Choose Effective Keywords
- Use specific job titles and skills
- Combine multiple relevant terms
- Test different keyword combinations

### Optimize Location Filters
- Use major city names for better results
- Consider metropolitan areas
- Test with and without location filters

### Balance Collection Size
- Start with smaller result sets for testing
- Increase gradually for production runs
- Monitor API rate limits and response times

### Proxy Configuration

For reliable results, residential proxies are recommended:

```json
{
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

## Integrations

Connect your job data with:

- **Google Sheets** — Export for team analysis and reporting
- **Airtable** — Build searchable job databases
- **Slack** — Get notifications for new job postings
- **Make** — Create automated recruitment workflows
- **Zapier** — Trigger actions based on job criteria

### Export Formats

Download data in multiple formats:

- **JSON** — For developers and API integrations
- **CSV** — For spreadsheet analysis and reporting
- **Excel** — For business intelligence dashboards

## Frequently Asked Questions

### How many jobs can I collect?
You can collect up to the available jobs on Shine.com. The practical limit depends on your search criteria and proxy configuration.

### Can I search for jobs in multiple locations?
Yes, you can run separate actor instances for different locations or use broader search terms.

### What if some job details are missing?
Some fields may be empty if the source doesn't provide that information. The actor collects all available data.

### How often should I run the scraper?
Job postings change frequently, so running daily or weekly is recommended for current data.

### Can I filter by salary range?
The actor extracts available salary information, but Shine.com's search doesn't always support salary filtering in the interface.

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Shine.com terms of service and applicable laws. Use data responsibly and respect rate limits.