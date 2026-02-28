# AdMonitor Pro - Complete Deployment Guide

## 🚀 Deployment to Vercel (Production)

### **IMPORTANT: Database Limitation ⚠️**
Your app currently uses `better-sqlite3` (file-based). Vercel serverless functions are **stateless** - files don't persist between requests.

**Solution:** Migrate to a cloud database. You have 3 options:

#### Option 1: **PostgreSQL** (Best for Production) ✅
- Use **Neon** (free tier: 3 projects, 500MB storage)
- Or **Supabase** (free tier: 2 projects, 500MB)
- Or **Railway** ($5/month shared PostgreSQL)

#### Option 2: **MongoDB** (Good for flexibility)
- Use **MongoDB Atlas** (free tier: 512MB storage)
- Simple integrations, good docs

#### Option 3: **Vercel KV** (Simple key-value)
- Use **Vercel KV** (Redis-like, limited free tier)
- Good for small datasets only

---

## 📊 Step-by-Step Deployment Process

### **Step 1: Update Database to PostgreSQL** (takes ~15 mins)

Your database needs to be updated from SQLite to PostgreSQL. We'll:
1. Create a Neon PostgreSQL database (free)
2. Update `server.ts` to use PostgreSQL client
3. Migrate existing data
4. Set environment variables

### **Step 2: Prepare Git Repository** (takes ~5 mins)

```bash
# Initialize git (if not already done)
git init
git add .
git commit -m "Initial commit: AdMonitor Pro"

# Create GitHub repo at https://github.com/new
# Then push
git remote add origin https://github.com/YOUR_USERNAME/admonitor-pro.git
git branch -M main
git push -u origin main
```

### **Step 3: Create Vercel Account & Deploy** (takes ~10 mins)

1. Go to https://vercel.com/signup
2. Sign up with GitHub
3. Click "Add New..." → "Project"
4. Select your `admonitor-pro` repository
5. Configure:
   - Framework: `Next.js` (Vite will be auto-detected)
   - Root Directory: `./`
   - Environment Variables:
     ```
     DATABASE_URL=postgresql://user:password@neon.tech/dbname
     NODE_ENV=production
     ```
6. Click "Deploy"

### **Step 4: Configure Custom Domain** (Optional, takes ~5 mins)

After deployment:
1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Update domain's DNS settings (Vercel provides instructions)

---

## 🔧 Configuration Files Needed

### **vercel.json** (Build configuration)
Create at project root with:
```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install"
}
```

### **.env.production** (For your local production testing)
```
DATABASE_URL=postgresql://user:password@host/dbname
NODE_ENV=production
```

### **.env.example** (For documentation)
```
DATABASE_URL=postgresql://user:password@host/dbname
GEMINI_API_KEY=your_api_key_here
NODE_ENV=production
```

---

## 📝 Database Migration Plan

**Before deployment:**
1. Create Neon PostgreSQL database (free at neon.tech)
2. Get connection string: `postgresql://user:password@host/dbname`
3. Update `server.ts` to use PostgreSQL instead of SQLite
4. Test locally with real database
5. Deploy to Vercel

**After deployment:**
1. Vercel will automatically run migrations
2. Data will persist across deployments
3. Recordings stored as base64 in PostgreSQL (works fine for production)

---

## ✅ Pre-Deployment Checklist

- [ ] Test app locally on http://localhost:3002
- [ ] Verify all features work (keywords, recording, export)
- [ ] Run `npm run build` - should complete without errors
- [ ] Run `npm run lint` - should have no TypeScript errors
- [ ] Create GitHub repository
- [ ] Set up PostgreSQL database (Neon or similar)
- [ ] Create `.env.production` with DATABASE_URL
- [ ] Add `vercel.json` to project
- [ ] Create Vercel account
- [ ] Connect GitHub repository to Vercel
- [ ] Set environment variables in Vercel dashboard
- [ ] Deploy!

---

## 🎯 What You Get After Deployment

✅ Public URL: `https://admonitor-pro.vercel.app`
✅ Auto-scaling (handles traffic spikes)
✅ SSL certificate (HTTPS, secure)
✅ Automatic deployments (push to GitHub → auto-deployed)
✅ Production database (data persists)
✅ Analytics dashboard in Vercel

---

## 📞 Troubleshooting After Deployment

### App shows "Cannot find module"
→ Check `vercel.json` buildCommand

### Database errors
→ Verify DATABASE_URL is set in Vercel environment variables

### Audio upload fails
→ Increase payload limit (already done in code, but verify)

### Slow performance
→ Check Vercel Analytics tab for bottlenecks

---

## 🔐 Security Checklist

- [ ] Database password is strong (24+ chars, mix of upper/lower/numbers/symbols)
- [ ] DATABASE_URL is set only in Vercel (not in code)
- [ ] HTTPS enabled (automatic on Vercel)
- [ ] CORS configured for your domain
- [ ] Rate limiting on API endpoints (optional, for production)
- [ ] No API keys in git history

---

## 📈 Scaling for Production

After initial deployment, consider:
1. **More storage** → Upgrade Neon plan ($7/month for more)
2. **CDN for audio** → Cloudflare ($20/month)
3. **Email notifications** → SendGrid or Mailgun
4. **Analytics** → Vercel Analytics
5. **Monitoring** → Sentry for error tracking

---

## 🎬 Next Steps

**Start with:**
1. Set up PostgreSQL (Neon) - 5 minutes
2. Update server.ts for PostgreSQL - 15 minutes
3. Test locally - 10 minutes
4. Push to GitHub - 5 minutes
5. Deploy to Vercel - 10 minutes

**Total time: ~45 minutes to production! 🚀**

