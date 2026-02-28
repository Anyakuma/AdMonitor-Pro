# AdMonitor Pro - Quick Start Deployment Guide

## 🎯 Your Deployment Path (Vercel + PostgreSQL)

### **Phase 1: Database Setup (5-10 minutes)**

#### Step 1A: Create Free PostgreSQL Database

1. Go to https://neon.tech (free tier available)
2. Click "Sign Up" → "Sign up with GitHub" (easiest)
3. Create new project:
   - **Project Name:** `admonitor-pro`
   - **Region:** Closest to your users
4. Once created, copy the connection string that looks like:
   ```
   postgresql://neondb_owner:xxxxx@ep-xxxxx.neon.tech/neondb
   ```
5. Save this string - you'll need it soon! 📝

#### Step 1B: Alternative - Use Supabase (Similar Free Tier)

If Neon is down or you prefer Supabase:
1. Go to https://supabase.com
2. Sign up with GitHub
3. Create new project
4. Go to "Settings" → "Database" → "Connection String"
5. Copy the PostgreSQL connection string

---

### **Phase 2: Update App Code (15-20 minutes)**

#### Step 2A: Install PostgreSQL Package

```bash
npm install pg
```

#### Step 2B: Update `server.ts` for PostgreSQL

Replace the `database.sqlite` setup in `server.ts` with PostgreSQL code...

**I can do this for you!** Just confirm and I'll:
- 🔄 Migrate from SQLite to PostgreSQL
- 📊 Create database tables automatically
- 🔐 Handle connection pooling
- 💾 Save existing keywords to PostgreSQL

---

### **Phase 3: Test Locally (5-10 minutes)**

```bash
# Create .env.local with your database URL
echo "DATABASE_URL=postgresql://your_connection_string_here" > .env.local

# Test the app
npm run dev

# Open http://localhost:3002 and test all features:
# ✓ Add keywords
# ✓ Start monitoring
# ✓ Download recordings
# ✓ Export ZIP
```

---

### **Phase 4: Git Setup (5 minutes)**

```bash
# If not already a git repo:
git init

# Add all files
git add .

# Make first commit
git commit -m "Initial commit: AdMonitor Pro - Production Ready"

# Create new GitHub repo at https://github.com/new
# Then:
git remote add origin https://github.com/YOUR_USERNAME/admonitor-pro.git
git branch -M main
git push -u origin main
```

---

### **Phase 5: Deploy to Vercel (10 minutes)**

1. Go to https://vercel.com/new
2. **Login with GitHub** (if not already logged in)
3. **Select "admonitor-pro" repository**
4. **Configure Project:**
   - Root Directory: `./`
   - Framework: Auto (Vite will be detected)
   - Build Command: `npm run build`
   - Output Directory: `dist`

5. **Add Environment Variables** (Important!):
   - Click "Add Environment Variable"
   - Name: `DATABASE_URL`
   - Value: `postgresql://your_connection_string_here`
   - Click "Add"

6. **Click "Deploy"** and wait ~3-5 minutes

7. **Get your URL:**
   - After deployment, you'll see: `https://admonitor-pro-xxxxx.vercel.app`
   - This is your live app! 🎉

---

## ✅ Verify Deployment Works

1. Open your Vercel URL in browser
2. Test these features:
   - ✅ Add a keyword
   - ✅ See the UI is styled (dark theme)
   - ✅ Try recording (permissions prompt)
   - ✅ See recordings list

**If something fails:**
- Check Vercel logs: Dashboard → Project → Deployments → View Build Logs
- Most common issue: `DATABASE_URL` not set in Vercel

---

## 🔄 Future Deployments (Super Easy!)

After the first deployment, deployment is **automatic**:

```bash
# Make changes locally
# Test on localhost:3002
# When ready:

git add .
git commit -m "Feature: add new functionality"
git push origin main

# Vercel automatically deploys! ✨
# Check your URL - updated in ~30 seconds
```

---

## 📊 What Happens at Each Stage

| Stage | Time | What You Setup |
|-------|------|-----------------|
| Database | 5 min | PostgreSQL on Neon/Supabase |
| Update Code | 20 min | Change app to use PostgreSQL |
| Test Local | 10 min | Verify everything works |
| Git | 5 min | Push code to GitHub |
| Deploy | 10 min | Connect GitHub → Vercel |
| **Total** | **~50 min** | **Live production app!** |

---

## 🎓 Learning Resources

- [Vercel Docs](https://vercel.com/docs)
- [Neon Docs](https://neon.tech/docs)
- [Node.js + PostgreSQL](https://www.postgresql.org/docs/current/libpq.html)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)

---

## 🆘 Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "CONNECTION REFUSED" | Check DATABASE_URL in Vercel env vars |
| "Cannot find module pg" | Run `npm install pg` and redeploy |
| "CORS errors" | Add your Vercel URL to allowed origins |
| "Recordings not saving" | Size limit? Check Express payload limit |

---

## ✨ What's Next After Deployment

🎯 **Immediate (Hours):**
- Share your live URL with team
- Test with real keywords
- Monitor first few recordings

📈 **This Week:**
- Set up custom domain (optional)
- Enable monitoring/analytics
- Fine-tune detection sensitivity

🔒 **Next Steps:**
- Add user authentication (if needed)
- Set up automated backups
- Configure alerts/notifications

---

## 🚀 Ready? Here's What I'll Do Next:

I can help with any of these steps:

1. **Migrate database** - I'll update `server.ts` to use PostgreSQL ✅
2. **Create build config** - Already done (vercel.json created)
3. **Test build locally** - Run `npm run build` to verify
4. **Push to GitHub** - Guide you through git commands
5. **Deploy to Vercel** - Step-by-step instructions

**What would you like to do first?**
