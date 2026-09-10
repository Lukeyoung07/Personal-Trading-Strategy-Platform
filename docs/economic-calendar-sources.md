# Economic calendar sources

The News / Economic Calendar stores normalized observations from official public sources. These records are not forecasts, signals, recommendations, or trading instructions.

## Federal Reserve FOMC

- **Source:** Federal Reserve FOMC meeting calendars
- **URL:** https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- **Automated retrieval:** Public HTML retrieval is currently reachable without credentials. No CAPTCHA, login, or access-control bypass is used.
- **Cost/API key:** £0 and no API key.
- **Attribution:** The Federal Reserve page is retained on each event. The Federal Reserve disclaimer says Board information is generally public domain with source citation.
- **Provides:** Official meeting dates.
- **Unavailable:** Exact time, forecast, previous, actual, and impact classification.
- **Usage limitation:** Third-party materials linked from the Federal Reserve site may have separate restrictions. Review applicable terms before commercial redistribution.

## UK Office for National Statistics

- **Source:** ONS Release Calendar RSS feed
- **URL:** https://www.ons.gov.uk/releasecalendar
- **Automated retrieval:** The site publishes an RSS feed intended for release-calendar syndication. No credentials or access-control bypass is used.
- **Cost/API key:** £0 and no API key.
- **Attribution/licensing:** The ONS page states that content is available under the Open Government Licence v3.0 except where otherwise stated. The source URL and source name are retained on each event.
- **Provides:** Release title, release URL, scheduled/published date and time, and published/upcoming state through separate RSS feeds.
- **Unavailable:** Forecast, previous, actual, and impact classification.
- **Usage limitation:** Check the OGL v3.0 terms and any release-specific exception before commercial redistribution.

## European Central Bank

- **Source:** ECB Governing Council meeting calendar
- **URL:** https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
- **Automated retrieval:** The public calendar page is currently reachable without credentials. No CAPTCHA, login, or access-control bypass is used.
- **Cost/API key:** £0 and no API key.
- **Attribution/licensing:** ECB copyright applies to the website. Events retain the ECB source name and URL. Future commercial redistribution should be reviewed against the ECB disclaimer/copyright terms and any required permission.
- **Provides:** Official meeting dates and meeting descriptions.
- **Unavailable:** Exact time, forecast, previous, actual, and impact classification.
- **Usage limitation:** Public accessibility does not by itself grant unrestricted commercial redistribution rights.

## Shared behavior

- Provider event IDs are stable and refreshes are idempotent.
- Missing values remain null or unclassified.
- Market mappings are informational only and do not predict direction.
- A failed source does not hide healthy sources. If every configured source fails, the API returns an unavailable error instead of presenting a fabricated empty calendar.