# AZE Ferma - Del Monte Platform

## Railway Deploy Guide

### 1. Create Railway Project
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Init project
railway init
```

### 2. Add PostgreSQL Database
- Go to Railway Dashboard
- Click "New" → "Database" → "Add PostgreSQL"
- Copy the DATABASE_URL

### 3. Environment Variables
Set these in Railway Dashboard → Variables:
```
DATABASE_URL=postgresql://... (auto-generated)
JWT_SECRET=your-random-secret-key
ADMIN_KEY=your-admin-key
NODE_ENV=production
```

### 4. Deploy
```bash
# Push to GitHub first
git init
git add .
git commit -m "Initial commit"
git push origin main

# Or deploy directly
railway up
```

### 5. Admin Panel
Access: `https://your-domain.com/api/admin/pending?adminKey=YOUR_ADMIN_KEY`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Qeydiyyat |
| POST | /api/auth/login | Giriş |
| GET | /api/user/profile | Profil |
| POST | /api/trees/buy | Ağac al |
| POST | /api/trees/water/:id | Su ver |
| POST | /api/trees/harvest/:id | Gəlir yığ |
| POST | /api/deposit | Depozit sorğusu |
| POST | /api/withdraw | Çıxarış sorğusu |
| GET | /api/transactions | Tarixçə |
| GET | /api/referral/stats | Referal statistikası |

## Tree Prices
| Ağac | Qiymət | Gündəlik | Müddət |
|------|--------|----------|--------|
| Nar | 10 AZN | 0.8 AZN | 30 gün |
| Armud | 25 AZN | 1.8 AZN | 30 gün |
| Mpopla | 100 AZN | 5.5 AZN | 30 gün |
| Banan | 250 AZN | 12.5 AZN | 30 gün |
| Ananas | 540 AZN | 28 AZN | 30 gün |
| Manqo | 1000 AZN | 50 AZN | 30 gün |

## Yeni funksiyalar
- Qeydiyyat: +994 + operator (50/51/55/70/77/99/10/12/40/44/60) + 7 rəqəm, şifrə 6-20
- Qeydiyyat bonusu: 1 AZN
- Xəzinə kodu (Xəzinə): POST /api/treasure/redeem
- Su vermə: gündə 1 dəfə, Gəlir yığma: gündə 1 dəfə
- Referal: dəvət olunan depozit etdikdə 10% cashback
- Depozit/Çıxarış saatları: 10:00-20:00

## Admin
- Gözləyən sorğular: GET /api/admin/pending?adminKey=KEY
- Depozit təsdiq: POST /api/admin/approve-deposit/:txId  body:{adminKey}
- Çıxarış təsdiq: POST /api/admin/approve-withdraw/:txId body:{adminKey}
- Sorğu ləğv: POST /api/admin/reject/:txId body:{adminKey}
- Xəzinə kodu yarat: POST /api/admin/treasure/create body:{adminKey,code,amount,maxUses}

## Telegram
- Depozit: @Delmontedepozit
- Müştəri xidməti: @delmonte01
- Kanal: https://t.me/+SYVQ4JwgJ3M3ZGMx
- Söhbət qrupu: https://t.me/+IvvXXzzOJIo2MDAx
