# 📁 AdMonitor Pro - Folder Structure & Organization

**Status**: ✅ Clean & Organized  
**Last Updated**: April 10, 2026  
**Commit**: ccf0cf6

---

## Directory Tree

```
admonitor-pro/
│
├─ 📄 Core Documentation (Root)
│  ├── README.md ........................ Project overview & quick start
│  └── CLAUDE.md ........................ Developer guide & architecture
│
├─ ⚙️ Configuration & Build Files (Root)
│  ├── package.json ..................... Dependencies & npm scripts
│  ├── package-lock.json ............... Locked dependency versions
│  ├── tsconfig.json ................... TypeScript configuration
│  ├── tsconfig.app.json .............. App TypeScript rules
│  ├── tsconfig.node.json ............. Node TypeScript rules
│  ├── vite.config.ts .................. Vite build configuration
│  ├── eslint.config.js ................ Code linting rules
│  ├── vercel.json ..................... Vercel deployment config
│  ├── index.html ...................... HTML entry point
│  ├── .env ............................ Environment variables (local)
│  ├── .env.example .................... Environment template
│  └── .gitignore ...................... Git ignore rules
│
├─ 💻 Source Code
│  ├── src/ ............................ React + TypeScript source
│  │   ├── App.tsx ..................... Main application component
│  │   ├── main.tsx .................... React DOM entry
│  │   ├── index.css ................... Global styles
│  │   ├── components/ ................. React components
│  │   ├── contexts/ ................... React context providers
│  │   ├── features/ ................... Feature modules
│  │   │   ├── audio/ .................. Audio service & hooks
│  │   │   ├── detection/ .............. Speech detection logic
│  │   │   └── recordings/ ............. Recording management
│  │   ├── lib/ ........................ Utility libraries
│  │   │   ├── media/ .................. Audio utilities
│  │   │   ├── performance/ ............ Optimization helpers
│  │   │   └── storage/ ................ Database wrapper
│  │   └── assets/ ..................... Static images/files
│  │
│  ├── public/ ......................... Public assets
│  │   ├── manifest.json ............... PWA manifest
│  │   ├── service-worker.js .......... Offline support
│  │   └── models/ ..................... ML models (optional)
│  │
│  ├── dist/ ........................... Production build output
│  │   ├── index.html .................. Built HTML
│  │   ├── assets/ ..................... Bundled assets
│  │   └── ... ......................... Optimized build files
│  │
│  └── server.ts ....................... Express backend server
│
├─ 📚 Documentation (docs/)
│  ├── QUICK_START.md .................. Getting started guide
│  ├── DEPLOYMENT_GUIDE.md ............ Production deployment instructions
│  ├── DEBUG_REPORT.md ................ Bugs fixed & debugging info
│  ├── PERFORMANCE_ANALYSIS.md ........ Performance metrics & optimization
│  ├── OPTIMIZATION_IMPLEMENTATION.md . Technical optimization details
│  └── BUG_FIXES_APPLIED.md ........... Complete list of bug fixes
│
├─ 🔧 Development & Metadata
│  ├── .git/ ........................... Git version control
│  ├── .vercel/ ........................ Vercel deployment metadata
│  ├── .agent/ ......................... Custom AI agent files
│  └── node_modules/ ................... NPM dependencies
│
```

---

## What Each Folder Contains

### Root Directory
- **Essential for deployment**: `package.json`, `vite.config.ts`, `server.ts`, `vercel.json`
- **Essential for development**: All `tsconfig.json` and `eslint.config.js`
- **Documentation**: `README.md` (main) and `CLAUDE.md` (dev guide)
- **Configuration**: `.env`, `.env.example`, `.gitignore`

### src/
Main application code. See `CLAUDE.md` for detailed architecture.

### public/
Static files served directly:
- `manifest.json` — PWA configuration
- `service-worker.js` — Offline support
- `models/` — Optional AI models (Vosk)

### dist/
Production build output (auto-generated):
- Optimized React bundle
- Minimized CSS/JavaScript
- Static assets with hashes

### docs/
All documentation organized in one place:
- Getting started guides
- Deployment procedures
- Performance analysis
- Bug reports & fixes

---

## Files Cleaned Up (Deleted)

**18 duplicate/outdated files removed**:

### From Root (9 deleted):
- ❌ DEPLOYMENT_COMPLETE.md (informational only)
- ❌ DEPLOYMENT_READY.md (duplication)
- ❌ PRE_DEPLOYMENT_CHECKLIST.md (consolidated)
- ❌ PERFORMANCE_* (multiple performance files) ← 5 files
- ❌ RECORDING_SAVE_FIX_REPORT.md (completed work)
- ❌ RECORDING_SAVE_TEST.md (test documentation)

### From docs/ (9 deleted):
- ❌ DEPLOYMENT_GUIDE.md (duplicate from root)
- ❌ EXECUTIVE_SUMMARY.md (redundant)
- ❌ FEATURE_PLAN_ANALYTICS.md (not needed)
- ❌ QUICK_DEPLOYMENT.md (duplicate)
- ❌ REFACTORING_* (2 files - completed work)
- ❌ TEST_RESULTS.md (outdated)
- ❌ PERFORMANCE_OPTIMIZATION* (2 files - consolidated)

**Result**: Maintained only essential, current documentation

---

## Key Features of New Structure

✅ **Clean Root** — Only config files, source code folder, docs folder, and 2 main docs  
✅ **Organized Docs** — All markdown files in `docs/` folder (except README.md, CLAUDE.md)  
✅ **No Duplicates** — Removed 18 obsolete or redundant files  
✅ **Standard Structure** — Follows industry best practices for Node/React projects  
✅ **Easy Navigation** — Clear separation of concerns  
✅ **Git-Tracked** — All changes committed and pushed to GitHub  

---

## Documentation Quick Links

| Document | Location | Purpose |
|----------|----------|---------|
| **README.md** | Root | Project overview |
| **CLAUDE.md** | Root | Developer guide |
| **QUICK_START.md** | docs/ | Getting started |
| **DEPLOYMENT_GUIDE.md** | docs/ | How to deploy |
| **DEBUG_REPORT.md** | docs/ | Bugs fixed |
| **PERFORMANCE_ANALYSIS.md** | docs/ | Performance info |

---

## How to Use This Structure

### For Development
```bash
# Start dev server
npm run dev

# Code lives in src/
# Config in root (vite.config.ts, tsconfig.json)
# Tests reference docs/DEBUG_REPORT.md
```

### For Deployment
```bash
# Build for production
npm run build

# Deploy dist/ to Vercel (configured in vercel.json)
npm run preview  # Test build locally first
```

### For Documentation
```bash
# Start with README.md (project overview)
# Then CLAUDE.md (architecture)
# Then docs/QUICK_START.md (getting started)
# Then docs/DEPLOYMENT_GUIDE.md (deploying)
```

---

## Git Status

**Latest Commit**: `ccf0cf6`  
**Message**: 🗂️ Clean up folder structure: organize docs, remove duplicates  
**Changes**: 22 files (5587 deletions of redundant content)  
**Status**: ✅ All changes committed and pushed to GitHub  

```bash
git log --oneline -1
# ccf0cf6 (HEAD -> main, origin/main) Clean up folder structure
```

---

## Before vs After

### Before (Cluttered)
```
Root: 24 files
  - 16 markdown files (.md)
  - Many duplicates (DEPLOYMENT_GUIDE.md in 2 places)
  - Outdated PERFORMANCE_* files (5 variations)
  - Intermediate work docs (RECORDING_SAVE_*, etc.)

docs/: 10 files
  - Duplicates of root files
  - Outdated files
  - Test results (no longer relevant)
```

### After (Clean) ✅
```
Root: 14 files
  - 2 essential markdown (README.md, CLAUDE.md)
  - 12 configuration/source files
  - Zero duplication

docs/: 6 files
  - 1 existing bug fixes file
  - 5 essential documentation files
  - All current and relevant
  - Non-redundant
```

**Space Saved**: ~5600 lines of redundant documentation deleted  
**Navigation**: Significantly improved  
**Maintainability**: Much easier to find and update docs  

---

## Next Steps

1. ✅ **Review**: Check the structure works for your needs
2. 📝 **Document**: Any project-specific notes in `docs/`
3. 🚀 **Deploy**: Structure is optimized for Vercel deployment
4. 📚 **Update**: Add new docs to `docs/` folder as needed

---

**Status**: Ready for production use  
**Last Cleaned**: April 10, 2026  
**Maintainable**: Yes ✅
