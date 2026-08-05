SELECT 'CREATE DATABASE n8n OWNER prospecting'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
