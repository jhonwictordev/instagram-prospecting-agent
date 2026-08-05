# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security** tab by opening a private security advisory. Do not include credentials, session data, or personal information in public issues.

## Secret handling

The repository must never contain `.env` files, browser profiles, screenshots, logs, database files, access tokens, or production credentials. Use `.env.example` only as a template and generate unique local secrets before running the project.
