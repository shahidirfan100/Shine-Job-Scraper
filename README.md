# Shine.com Jobs Scraper - India's Leading Job Portal Data Extraction

> **Professional Job Data Scraper** - Extract comprehensive job listings from Shine.com, India's premier job search platform with millions of active job postings

Extract detailed job market intelligence from Shine.com, India's largest job portal. This powerful scraper collects complete job data including salaries, skills, company information, and detailed descriptions. Perfect for recruitment agencies, HR analytics, job market research, and competitive intelligence.

## 🎯 What You Can Achieve

- **Job Market Analysis**: Track salary trends, skill demands, and industry growth across Indian job market
- **Recruitment Intelligence**: Identify top companies hiring, popular job categories, and location-based opportunities
- **Competitive Research**: Monitor competitor hiring patterns and talent acquisition strategies
- **Career Insights**: Analyze job requirements, experience levels, and skill gaps in various industries
- **Business Intelligence**: Gather data for workforce planning, training programs, and market expansion

## ✨ Key Features & Capabilities

### 🔍 Advanced Job Search & Filtering
- **Keyword-Based Search**: Search by job titles, skills, technologies, or company names
- **Location Targeting**: Filter jobs by cities, states, or regions across India
- **Category Filtering**: Extract jobs from specific industries and departments
- **Custom URL Support**: Scrape specific search results or job categories

### 📊 Comprehensive Data Extraction
- **Complete Job Details**: Title, company, location, salary range, experience requirements
- **Rich Descriptions**: Full job descriptions with formatting preserved
- **Skills & Technologies**: Extract required skills, tools, and qualifications
- **Company Information**: Hiring company details and industry classification
- **Posting Metadata**: Job posting dates, employment types, and application deadlines

### 🚀 Performance & Reliability
- **High-Speed Scraping**: Process 40-80 jobs per minute with optimized performance
- **Smart Pagination**: Automatically navigate through multiple result pages
- **Precise Job Limits**: Stops exactly when desired number of jobs is reached
- **Resource Efficient**: No unnecessary requests when jobs aren't available
- **Anti-Detection Measures**: Built-in mechanisms to ensure consistent data collection
- **Error Recovery**: Intelligent retry logic for maximum success rate
- **Scalable Architecture**: Handle thousands of jobs in single execution

### 💾 Structured Data Output
- **JSON Schema**: Consistent, machine-readable data format
- **Database Ready**: Direct integration with analytics tools and databases
- **API Compatible**: Easy integration with existing HR and recruitment systems
- **Export Options**: Multiple download formats for different use cases

## 📈 Use Cases & Applications

### For Recruitment Agencies
- **Lead Generation**: Identify companies with active hiring needs
- **Market Intelligence**: Track demand for specific skills and roles
- **Client Prospecting**: Find companies in expansion mode

### For HR Departments
- **Salary Benchmarking**: Compare compensation across industries and locations
- **Skills Gap Analysis**: Identify trending technologies and qualifications
- **Talent Pool Mapping**: Understand regional talent availability

### For Job Portals & Career Platforms
- **Content Aggregation**: Enrich job listings with additional data
- **Market Research**: Analyze job market trends and patterns
- **Competitive Analysis**: Compare job offerings across platforms

### For Educational Institutions
- **Curriculum Development**: Align courses with industry skill requirements
- **Career Counseling**: Provide data-driven career guidance
- **Industry Partnerships**: Identify collaboration opportunities

### For Business Intelligence
- **Workforce Planning**: Predict hiring trends and skill demands
- **Market Expansion**: Identify high-growth regions and industries
- **Investment Research**: Analyze employment patterns for business decisions

## 📥 Input Parameters & Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keyword` | String | No | - | Search term (job title, skill, technology, company name) |
| `location` | String | No | - | Geographic filter (city, state, region in India) |
| `category` | String | No | - | Job category or industry sector |
| `datePosted` | String | No | anytime | Filter jobs by posting date (anytime, 24hours, 7days, 30days, 90days) |
| `startUrl` | String | No | - | Direct Shine.com search URL to begin scraping |
| `startUrls` | Array | No | - | Multiple URLs for batch processing |
| `results_wanted` | Number | No | 100 | Total jobs to collect (1-10000) |
| `max_pages` | Number | No | 999 | Maximum search pages to process |
| `collectDetails` | Boolean | No | true | Extract full job descriptions |
| `proxyConfiguration` | Object | No | - | Proxy settings for enhanced reliability |

## 🎯 Quick Start Examples

### Basic Job Search
```json
{
  "keyword": "software engineer",
  "location": "Bangalore",
  "results_wanted": 50
}
```
*Collects 50 software engineering jobs in Bangalore*

### Industry-Specific Research
```json
{
  "keyword": "data scientist",
  "location": "Mumbai",
  "category": "IT",
  "results_wanted": 200
}
```
*Extracts data science positions in Mumbai's IT sector*

### Company Hiring Analysis
```json
{
  "keyword": "developer",
  "location": "Delhi",
  "results_wanted": 100,
  "collectDetails": true
}
```
*Comprehensive developer job data from Delhi with full descriptions*

### Custom Search URL
```json
{
  "startUrl": "https://www.shine.com/job-search/machine-learning-jobs-in-pune",
  "results_wanted": 150
}
```
*Targeted scraping of machine learning jobs in Pune*

### Recent Jobs Only
```json
{
  "keyword": "product manager",
  "location": "Bangalore",
  "datePosted": "7days",
  "results_wanted": 50
}
```
*Find product manager positions posted in the last 7 days in Bangalore*

### Multi-City Analysis
```json
{
  "startUrls": [
    "https://www.shine.com/job-search/marketing-jobs-in-mumbai",
    "https://www.shine.com/job-search/marketing-jobs-in-delhi",
    "https://www.shine.com/job-search/marketing-jobs-in-bangalore"
  ],
  "results_wanted": 300
}
```
*Marketing job comparison across major Indian cities*

## 📤 Complete Output Schema

Every job record includes comprehensive structured data:

```json
{
  "title": "Senior Software Engineer - Backend",
  "company": "Tech Mahindra Ltd.",
  "category": "Information Technology",
  "location": "Pune, Maharashtra",
  "salary": "₹12,00,000 - ₹18,00,000 per year",
  "experience": "5-8 Years",
  "skills": ["Java", "Spring Boot", "Microservices", "AWS", "Docker"],
  "industry": "IT Services",
  "employment_type": "Full-time",
  "date_posted": "2024-11-12",
  "description_html": "<div><p>We are looking for an experienced Backend Developer...</p></div>",
  "description_text": "We are looking for an experienced Backend Developer to join our growing team...",
  "url": "https://www.shine.com/jobs/senior-software-engineer-backend/tech-mahindra/pune/12345",
  "scraped_at": "2024-11-12T14:30:00.000Z"
}
```

### Data Fields Explained

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Job position title | "Senior Software Engineer" |
| `company` | Hiring organization | "Tech Mahindra Ltd." |
| `category` | Job function/department | "Information Technology" |
| `location` | Work location | "Pune, Maharashtra" |
| `salary` | Compensation range | "₹12,00,000 - ₹18,00,000 per year" |
| `experience` | Required experience | "5-8 Years" |
| `skills` | Required competencies | ["Java", "AWS", "Docker"] |
| `industry` | Business sector | "IT Services" |
| `employment_type` | Job type | "Full-time" |
| `date_posted` | Posting date | "2024-11-12" |
| `description_html` | Formatted job details | HTML content |
| `description_text` | Plain text description | Clean text |
| `url` | Job posting link | Direct Shine.com URL |
| `scraped_at` | Data collection timestamp | ISO 8601 format |

## 🚀 How to Use

### Apify Platform (Recommended)

1. **Access Actor Store**: Search for "Shine.com Jobs Scraper"
2. **Create New Task**: Click "Try for free" or "Create task"
3. **Configure Parameters**: Set your search criteria and preferences
4. **Execute**: Run the actor and monitor real-time progress
5. **Download Results**: Export data in your preferred format

### API Integration

```bash
# Start scraping job
curl -X POST "https://api.apify.com/v2/acts/your-actor-id/runs" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "product manager",
    "location": "Bangalore",
    "results_wanted": 100
  }'

# Check run status
curl "https://api.apify.com/v2/acts/your-actor-id/runs/RUN_ID" \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# Download results
curl "https://api.apify.com/v2/acts/your-actor-id/runs/RUN_ID/dataset/items" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Webhook Integration

Configure webhooks to automatically receive data when scraping completes:

```json
{
  "webhookUrl": "https://your-app.com/webhook",
  "webhookHeaders": {
    "Authorization": "Bearer YOUR_WEBHOOK_TOKEN"
  }
}
```

## ⚙️ Advanced Configuration

### Performance Tuning

| Setting | Fast Mode | Balanced Mode | Comprehensive Mode |
|---------|-----------|---------------|-------------------|
| `collectDetails` | `false` | `true` | `true` |
| `results_wanted` | 100-500 | 500-2000 | 2000-10000 |
| `maxConcurrency` | High (10+) | Medium (8-10) | Low (5-8) |
| `Speed` | 80+ jobs/min | 60-80 jobs/min | 40-60 jobs/min |
| `Use Case` | Quick research | Standard analysis | Deep insights |

### Proxy Configuration

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

### Error Handling

- **Automatic Retries**: Failed requests are automatically retried
- **Graceful Degradation**: Continues processing even if some jobs fail
- **Progress Tracking**: Real-time monitoring of scraping progress
- **Detailed Logs**: Comprehensive error reporting and diagnostics

## 📊 Performance Metrics & Costs

### Speed & Throughput
- **Basic Mode**: 60-80 jobs per minute
- **Detailed Mode**: 40-60 jobs per minute
- **Batch Processing**: Up to 10,000 jobs per execution
- **Concurrent Processing**: Multiple searches simultaneously

### Resource Usage
- **Memory**: 256-1024 MB (based on job volume)
- **Compute Units**: 0.5-2.0 CU per 1000 jobs
- **Network**: Optimized for minimal bandwidth usage
- **Storage**: Efficient JSON compression

### Cost Estimation

| Job Volume | Estimated Credits | Execution Time | Cost per Job |
|------------|------------------|----------------|--------------|
| 100 jobs | 0.1 - 0.3 | 2-5 minutes | ~0.001 credits |
| 1,000 jobs | 1.0 - 3.0 | 15-30 minutes | ~0.002 credits |
| 10,000 jobs | 10.0 - 30.0 | 2-4 hours | ~0.002 credits |

*Actual costs may vary based on proxy usage and data complexity*

## 🔧 Troubleshooting Guide

### Common Issues & Solutions

#### No Results Found
**Problem**: Actor returns empty dataset
**Solutions**:
- Verify keyword spelling and relevance
- Check location format (use major city names)
- Try broader search terms
- Ensure URL format is correct for custom URLs

#### Incomplete Job Data
**Problem**: Missing descriptions or company information
**Solutions**:
- Set `collectDetails: true` for full descriptions
- Check if jobs are still active on Shine.com
- Verify proxy configuration for better access

#### Slow Performance
**Problem**: Scraping takes longer than expected
**Solutions**:
- Reduce `results_wanted` for faster execution
- Set `collectDetails: false` if descriptions not needed
- Use more specific search parameters
- Enable proxy configuration

#### Rate Limiting
**Problem**: Actor gets blocked or slowed down
**Solutions**:
- Enable residential proxies
- Reduce concurrency settings
- Add delays between requests
- Use different IP ranges

#### Data Quality Issues
**Problem**: Inconsistent or malformed data
**Solutions**:
- Check Shine.com website for recent changes
- Verify input parameters are correct
- Review actor logs for parsing errors
- Contact support for schema updates

### Error Codes & Meanings

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `INVALID_URL` | Malformed search URL | Check URL format and parameters |
| `NO_RESULTS` | Search returned no jobs | Try different keywords or locations |
| `PROXY_ERROR` | Proxy connection failed | Enable Apify Proxy or check configuration |
| `PARSE_ERROR` | HTML parsing failed | Website structure may have changed |
| `RATE_LIMITED` | Too many requests | Reduce speed or enable proxies |

## 📞 Support & Resources

### Getting Help
- **Documentation**: Complete API reference and examples
- **Community**: Join Apify community discussions
- **Support**: Direct support through Apify platform
- **Updates**: Regular improvements and feature additions

### Best Practices
- **Test First**: Run small batches before large extractions
- **Monitor Usage**: Track costs and performance metrics
- **Data Validation**: Always verify data quality and completeness
- **Regular Updates**: Check for actor updates and improvements

## 🔄 Changelog & Updates

### Recent Improvements
- ✅ **Precise Job Limiting**: Script now stops exactly when desired number of jobs is reached
- ✅ **Resource Efficiency**: No unnecessary requests when jobs aren't available
- ✅ **Graceful Termination**: Stops pagination intelligently when no more jobs found
- ✅ Enhanced performance with 10 concurrent requests for faster scraping
- ✅ Optimized session management with larger session pools (50 sessions)
- ✅ Improved rate limiting (80 requests/minute) while maintaining stealth
- ✅ Intelligent delay algorithms based on session maturity
- ✅ Enhanced data accuracy and completeness
- ✅ Better error handling and recovery
- ✅ Added comprehensive job category detection
- ✅ Improved handling of dynamic content

### Roadmap
- 🔄 Real-time job posting monitoring
- 🔄 Advanced filtering and search options
- 🔄 Integration with popular HR platforms
- 🔄 Historical data collection and trends
- 🔄 Multi-language support for international jobs

---

**🔒 Compliance Note**: This actor is designed for legitimate business intelligence and research purposes. Always respect Shine.com's terms of service and applicable data protection regulations. Use responsibly and ethically.