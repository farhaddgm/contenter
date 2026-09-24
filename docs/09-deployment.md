# استقرار

## با Docker Compose (یک سرور)

```bash
cp apps/api/.env.example apps/api/.env
# حتماً تنظیم کنید: JWT_ACCESS_SECRET، JWT_REFRESH_SECRET (رشتهٔ تصادفی طولانی)،
# AI_PROVIDER=anthropic، ANTHROPIC_API_KEY، COOKIE_SECURE=true (پشت HTTPS)، SEED_ADMIN_PASSWORD
docker compose --profile app up -d --build
docker compose exec api npx -w @contenter/api prisma db seed   # فقط بار اول
```

سرویس‌ها:

| سرویس | نقش |
|---|---|
| `web` (nginx، پورت 8080) | فایل‌های استاتیک + پراکسی `/api` به `api` (هم‌مبدأ؛ بدون مشکل CORS/کوکی) |
| `api` (`APP_ROLE=api`) | HTTP؛ هنگام شروع `prisma migrate deploy` اجرا می‌کند |
| `worker` (`APP_ROLE=worker`) | مصرف‌کنندهٔ صف BullMQ؛ برای مقیاس، تعداد replica را بالا ببرید |
| `postgres`، `redis` | داده و صف |

جلوی `web` یک reverse proxy با TLS (Caddy/Traefik/nginx) قرار دهید.

## مقیاس‌پذیری
- **API** بدون state است → چند نمونه پشت load balancer.
- **Worker** افقی مقیاس می‌گیرد؛ هم‌زمانی هر نمونه با `WORKER_CONCURRENCY`.
- محدودیت نرخ API مدل: با کاهش `WORKER_CONCURRENCY` یا افزودن rate limiter صف کنترل کنید.
- پایگاه داده: ایندکس‌های لازم در schema تعریف شده‌اند؛ برای بار بالا از PgBouncer استفاده کنید.

## چک‌لیست تولید
- [ ] رازهای JWT تصادفی و محرمانه
- [ ] `COOKIE_SECURE=true` و HTTPS
- [ ] `CORS_ORIGINS` فقط دامنهٔ فرانت
- [ ] `FETCH_ALLOW_PRIVATE=false`
- [ ] رمز ادمین seed تغییر کرده باشد
- [ ] پشتیبان‌گیری منظم از PostgreSQL
- [ ] پایش `/api/health` و صفحهٔ «کارهای AI» برای خطاها
