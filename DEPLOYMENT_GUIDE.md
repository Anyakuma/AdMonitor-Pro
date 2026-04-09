# AdMonitor Pro - Deployment Guide

**Status**: ✅ READY FOR PRODUCTION  
**Build Version**: 5.37s optimized build  
**Date**: April 10, 2026

---

## Quick Deploy Options

### Option 1: Deploy to Vercel (Recommended - 2 minutes)

Vercel is pre-configured in `vercel.json` and provides automatic deployments from Git.

#### Prerequisites
- Vercel account (free tier available)
- Git repository (GitHub/GitLab/Bitbucket)

#### Steps

**1. Connect Git Repository to Vercel**
```bash
# Option A: Using Vercel CLI
npm install -g vercel
vercel login
vercel

# Option B: Using Vercel.com Dashboard
# Go to vercel.com → New Project → Import Git Repository
# Select your admonitor-pro repository
```

**2. Configure Environment Variables in Vercel Dashboard**

In Project Settings → Environment Variables, add:

```
NODE_ENV = production
DATABASE_URL = postgresql://username:password@host:5432/dbname?sslmode=require
PORT = 3002
GEMINI_API_KEY = (optional, leave blank if not using)
```

⚠️ **CRITICAL**: Get `DATABASE_URL` from one of these providers:
- **Neon** (PostgreSQL): https://neon.tech - Free tier available
- **Supabase** (PostgreSQL): https://supabase.com - Free tier available  
- **AWS RDS**: Production-grade option
- **Heroku Postgres**: Paid option
- **DigitalOcean**: Budget-friendly option

**Format**: `postgresql://user:password@host:port/dbname?sslmode=require`

**3. Deploy**
```bash
# Automatic: Push to main branch
git push origin main
# Vercel auto-deploys

# Or manual:
vercel --prod
```

**4. Verify Deployment**
```bash
# Check your Vercel dashboard for deployment status
# Your app will be live at: https://your-project.vercel.app

# Test endpoints:
curl https://your-project.vercel.app/api/keywords
curl https://your-project.vercel.app/api/recordings
```

---

### Option 2: Deploy to Self-Hosted Server (20 minutes)

#### Prerequisites
- Node.js 20+ installed
- Linux server (Ubuntu 22+ recommended)
- SSH access to server
- PostgreSQL database (or managed database like Neon)

#### Steps

**1. Prepare Server**
```bash
# SSH into your server
ssh user@your-server.com

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (20+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install git (if not present)
sudo apt install -y git
```

**2. Clone Repository**
```bash
cd /var/www
git clone https://github.com/your-org/admonitor-pro.git
cd admonitor-pro
npm install
```

**3. Create .env File**
```bash
cat > .env << EOF
NODE_ENV=production
DATABASE_URL=postgresql://username:password@host:port/dbname?sslmode=require
PORT=3002
GEMINI_API_KEY=your_key_here
EOF

chmod 600 .env  # Secure permissions
```

**4. Build Application**
```bash
npm run build
```

**5. Install Process Manager (PM2)**
```bash
sudo npm install -g pm2

# Start app
pm2 start npm --name "admonitor" -- start

# Auto-restart on reboot
pm2 startup
pm2 save
```

**6. Setup Nginx Reverse Proxy**
```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/admonitor`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Gzip compression
    gzip on;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;
}
```

Enable site and restart:
```bash
sudo ln -s /etc/nginx/sites-available/admonitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**7. Setup SSL Certificate (Let's Encrypt)**
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d yourdomain.com
```

**8. Verify Deployment**
```bash
# Check PM2
pm2 status

# Test endpoints
curl https://yourdomain.com/api/keywords
curl https://yourdomain.com/api/recordings
```

---

### Option 3: Deploy to Docker (30 minutes)

#### Prerequisites
- Docker installed on your server
- Docker Registry (Docker Hub, GitHub Container Registry, etc.)

#### Steps

**1. Create Dockerfile**

Place in project root:
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
EXPOSE 3002
CMD ["node", "server.ts"]
```

**2. Create .dockerignore**
```
node_modules
npm-debug.log
dist
.git
.gitignore
.env.local
.DS_Store
```

**3. Build & Push Docker Image**
```bash
# Build locally
docker build -t admonitor-pro:latest .

# Or push to registry
docker tag admonitor-pro:latest yourusername/admonitor-pro:latest
docker push yourusername/admonitor-pro:latest
```

**4. Deploy with Docker Compose**

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  app:
    image: yourusername/admonitor-pro:latest
    ports:
      - "3002:3002"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://user:password@postgres:5432/admonitor
      PORT: 3002
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: admonitor
      POSTGRES_USER: admonitor_user
      POSTGRES_PASSWORD: secure_password_here
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

**5. Deploy**
```bash
docker-compose up -d
docker-compose logs -f app  # View logs
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass: `npm run lint`
- [ ] Production build succeeds: `npm run build`
- [ ] No console errors or warnings
- [ ] Git repository is up to date
- [ ] All changes committed and pushed
- [ ] Environment variables documented
- [ ] Database provider selected and account created
- [ ] SSL certificate plan (Vercel: auto, Self-hosted: Let's Encrypt)

### During Deployment
- [ ] Deploy to staging first (if available)
- [ ] Monitor build logs for errors
- [ ] Verify API endpoints respond: `/api/keywords`, `/api/recordings`
- [ ] Test recording save flow on production
- [ ] Verify HTTPS is enforced
- [ ] Check database connectivity

### Post-Deployment
- [ ] App loads without errors
- [ ] Microphone permission still works
- [ ] Recording save persists across refresh
- [ ] Keywords sync to database
- [ ] Export ZIP works
- [ ] Mobile version responsive
- [ ] No 5xx server errors in logs
- [ ] Performance acceptable (<2s load time)
- [ ] Monitor error logs for 24 hours
- [ ] Document any issues found

---

## Database Setup

### For Neon (Recommended - Free PostgreSQL)

1. Go to https://neon.tech
2. Sign up with email/GitHub
3. Create new project
4. Copy connection string (without `?sslmode=require` since Neon adds it)
5. Example: `postgresql://neon_user:neonpwd@ep-xyz.neon.tech/neondb`

### For Supabase

1. Go to https://supabase.com
2. Create new project (select PostgreSQL)
3. Go to Settings → Database → URI
4. Copy the URI within Supabase
5. Example: `postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres`

### For AWS RDS

1. Create RDS PostgreSQL instance
2. Set up security group for your server/Vercel IP
3. Get endpoint from RDS console
4. Example: `postgresql://admin:pwd@mydb.c9akciq32.us-east-1.rds.amazonaws.com:5432/admonitor`

**All formats**: `postgresql://username:password@host:port/dbname?sslmode=require`

---

## Post-Deployment Configuration

### Enable HTTPS Everywhere
All production deployments MUST use HTTPS. Web Speech API requires secure context.

- **Vercel**: Automatic (included)
- **Self-hosted**: Use Let's Encrypt via Certbot
- **Docker**: Terminate SSL at Nginx/load balancer

### Database Backups
Set up automated backups:
- **Neon**: Automatic daily backups included
- **Supabase**: Automated backups, point-in-time recovery available
- **AWS RDS**: Enable automated backups in console
- **Self-hosted PostgreSQL**: Set up `pg_dump` cron job

### Monitoring & Logging

**Vercel**: Built-in analytics in dashboard
**Self-hosted**: Set up with:
```bash
# View logs
pm2 logs admonitor
pm2 logs admonitor --lines 100 --nostream

# Or use journalctl
sudo journalctl -u nginx -f
```

### Environment Secrets Security

**NEVER commit .env files to git!**

Use git-ignored file:
```bash
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
git add .gitignore
git commit -m "Secure: ignore .env files"
git push
```

---

## Troubleshooting

### "Cannot POST /api/recordings"
- **Cause**: Express.json middleware not processing request
- **Fix**: Check `Content-Type: application/json` header in requests
- **Verify**: `curl -X POST http://localhost:3002/api/keywords -d '{"word":"test"}' -H "Content-Type: application/json"`

### "Database connection refused"
- **Cause**: DATABASE_URL invalid or database unreachable
- **Fix**: 
  1. Verify DATABASE_URL in .env
  2. Check PostgreSQL is running and reachable
  3. Verify firewall rules allow connection
  4. Test connection: `psql postgres://user:pass@host:5432/db`

### "HTTPS required" Error on Mobile
- **Cause**: App loaded over HTTP on non-localhost
- **Fix**: Deploy with HTTPS only (both Vercel and self-hosted must use HTTPS)

### "Microphone access denied"
- **Cause**: User denied permission or not HTTPS
- **Fix**: Ensure HTTPS, check browser permissions settings

### Build Takes Too Long
- **Current**: 5.37 seconds (optimized)
- **If slower**: Check disk space, network, Node.js version

---

## Scaling Considerations

### Current Limitations
- **Max concurrent users**: ~100 (without load balancer)
- **Recording storage**: Depends on DATABASE_URL provider limits
- **Base64 audio**: Each 60s recording ≈ 1-2 MB in database

### To Scale Beyond 100 Users
1. Add load balancer (Vercel does automatically)
2. Enable database connection pooling
3. Move media to S3/Blob storage instead of base64
4. Add Redis cache layer for keywords
5. Consider dedicated database tier

---

## Rollback Plan

If deployment fails:

**Vercel**:
```bash
# Automatic: Previous deployment available in dashboard
# Manual: Click "Redeploy" on previous deployment
```

**Self-hosted**:
```bash
cd /var/www/admonitor-pro
git revert HEAD
npm run build
pm2 restart admonitor
```

**Docker**:
```bash
docker-compose down
docker pull yourusername/admonitor-pro:previous-tag
docker-compose up -d
```

---

## Support

### Common Deployment Resources
- **Vercel Docs**: https://vercel.com/docs
- **Express.js Guide**: https://expressjs.com/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Docker Docs**: https://docs.docker.com/

### Environment-Specific Help
- **Neon**: https://neon.tech/docs
- **Supabase**: https://supabase.com/docs
- **AWS RDS**: https://docs.aws.amazon.com/rds/
- **DigitalOcean**: https://docs.digitalocean.com/

---

## Deployment Summary

| Option | Time | Cost | Scale | Easy |
|--------|------|------|-------|------|
| **Vercel** | 2 min | Free/Pro | Good | ✅✅✅ |
| **Self-hosted** | 20 min | Varies | Excellent | ✅ |
| **Docker** | 30 min | Varies | Excellent | ✅✅ |

**Recommended for most uses**: Vercel (easiest, automatic scaling, free tier sufficient)

---

**Deployment Status**: READY  
**Last Updated**: April 10, 2026  
**Signed Off**: Production Ready
