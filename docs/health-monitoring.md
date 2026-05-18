# Health Monitoring

Configure an external monitor, for example Uptime Robot or Better Uptime:

- URL: `https://api.solarnext-crm.fr/api/health/ready`
- Method: `GET`
- Interval: 60 seconds
- Alert condition: any non-`200` response or timeout
- Expected alert delay: under 2 minutes

Use `/api/health/live` only for load balancer liveness checks. It intentionally does not check the database or external dependencies.

Readiness returns `503` with per-dependency details when degraded, including database latency, PDF renderer availability, mail connectivity, shading cache availability, and PVGIS API availability.
