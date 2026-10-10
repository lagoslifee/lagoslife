# Local operations

## Database backup and restore

```bash
docker compose exec -T postgres pg_dump -U lagos -Fc lagos_living > backup.dump
docker compose exec -T postgres pg_restore -U lagos -d lagos_living --clean < backup.dump
```

Test restores against a disposable database before relying on a backup.

## Production preparation

Use managed PostgreSQL with point-in-time recovery, TLS, automated backups, and
a least-privilege application role. Supply strong independent values for
`BETTER_AUTH_SECRET` and database credentials through the host's secret store.
Configure a transactional email provider through the SMTP variables. Place web
and WebSocket traffic behind HTTPS/WSS, restrict `WEB_ORIGIN`, and run migrations
as a one-off release task before application instances start.

Public deployment is intentionally not configured or performed yet. Hosting
selection and recurring cost require owner approval after the review build.
