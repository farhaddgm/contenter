# راهنمای نگهداری سرور (برای غیرمتخصص)

این راهنما برای سرور فعلی Contenter است: سایت `https://contenter.beeproject.ir`، پوشهٔ `~/contenter` روی سرور `82.115.8.115`.

همهٔ دستورها **روی سرور** اجرا می‌شوند. برای ورود به سرور، در ویندوز **PowerShell** را باز کنید و بزنید:

```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" farhaad-ai
```

بعد از ورود، اول همیشه به پوشهٔ برنامه بروید:

```bash
cd ~/contenter
```

ابتدای خط باید `~/contenter$` باشد. اگر `~$` است، هنوز در پوشهٔ اشتباهید.

---

## ۱. انتشار نسخهٔ جدید (مهم‌ترین کار)

وقتی [انتشار خودکار](#۹-انتشار-خودکار-از-github) راه‌اندازی شده باشد، لازم نیست کاری بکنید: هر تغییری که روی شاخهٔ `main` برود، بعد از سبز شدن تست‌ها (CI) خودش روی سرور منتشر می‌شود. نتیجه را در GitHub ← **Actions** ← **Deploy** ببینید.

انتشار دستی همیشه هم کار می‌کند، با همین یک دستور:

```bash
bash scripts/deploy.sh
```

این دستور به‌ترتیب:
1. بررسی می‌کند فایل تنظیمات (`apps/api/.env`) سالم و کامل باشد. اگر خالی یا ناقص باشد، **قبل از هر تغییری** متوقف می‌شود.
2. فضای دیسک را بررسی می‌کند و اگر کم باشد، کش موقت Docker را پاک می‌کند.
3. از **پایگاه داده**، **فایل تنظیمات** و **فایل‌های بارگذاری‌شده** پشتیبان می‌گیرد (در پوشهٔ `~/contenter-backups`؛ ۱۴ نسخهٔ آخر، و برای فایل‌های بارگذاری‌شده ۳ نسخهٔ آخر، نگه داشته می‌شود) و اگر [پشتیبان بیرون از سرور](#۸-پشتیبان-بیرون-از-سرور) تنظیم شده باشد، یک نسخهٔ رمزشده هم به آن‌جا می‌فرستد.
4. آخرین نسخه را از GitHub می‌گیرد.
5. برنامه را می‌سازد و دوباره راه می‌اندازد. تغییرات پایگاه داده (migration) خودکار اعمال می‌شوند.
6. بررسی می‌کند همهٔ بخش‌ها (api، worker، web، postgres، redis) سالم و روشن باشند.
7. فایل‌های موقت قدیمی Docker را پاک می‌کند تا دیسک دوباره پر نشود، و در پایان پیام سبز **Deploy finished** نشان می‌دهد.

اگر پیام قرمز ✘ دیدید، متن آن را کپی کنید و برای Claude بفرستید.

> ⚠️ هرگز روی سرور `npm run db:migrate` نزنید. آن دستور مخصوص کامپیوتر توسعه است و روی سرور ممکن است به داده‌ها آسیب بزند.

## ۲. بررسی سلامت

```bash
docker compose ps
```

باید پنج سرویس `api`، `worker`، `web`، `postgres` و `redis` همه `Up` باشند. از بیرون هم آدرس `https://contenter.beeproject.ir/api/health` باید `"status":"ok"` نشان دهد.

اگر یکی `Exited` یا `Restarting` بود، لاگ آن را ببینید (به‌جای `api` نام سرویس را بگذارید):

```bash
docker compose logs api --tail 40
```

## ۳. ویرایش فایل تنظیمات (`.env`)

```bash
nano apps/api/.env
```

- ذخیره: **Ctrl+O** سپس **Enter** — خروج: **Ctrl+X**
- **قبل از ویرایش** مطمئن شوید دیسک پر نیست: `df -h /` (ستون `Avail` باید چند گیگابایت باشد). ذخیره روی دیسک پر، فایل را **خالی** می‌کند — این اتفاق یک بار افتاده است.
- بعد از هر تغییر در `.env`، برای اعمال شدن:

```bash
docker compose --profile app up -d
```

### اگر `.env` خالی یا خراب شد
پشتیبان‌ها را ببینید (جدیدترین پایین است):

```bash
ls -ltr apps/api/.env.bak-* ~/contenter-backups/env-*
```

جدیدترین پشتیبان سالم را جایگزین کنید (نام فایل را با مورد واقعی عوض کنید)، بعد برنامه را راه بیندازید:

```bash
cp ~/contenter-backups/env-20260929-200000 apps/api/.env
chmod 600 apps/api/.env
docker compose --profile app up -d
```

## ۴. دیسک پر شد («no space left on device»)

```bash
df -h /
docker builder prune -f
docker image prune -f
df -h /
```

این دو دستور فقط فایل‌های موقت ساخت و نسخه‌های بی‌استفادهٔ قدیمی را پاک می‌کنند و به داده‌ها کاری ندارند. اگر باز هم جا کم بود، ادامه ندهید و از Claude کمک بگیرید.

## ۵. بازگرداندن پایگاه داده از پشتیبان (فقط در شرایط اضطراری)

با Claude هماهنگ کنید؛ این کار داده‌های فعلی را با نسخهٔ پشتیبان جایگزین می‌کند. پشتیبان‌ها در `~/contenter-backups/db-*.sql.gz` هستند. اگر خود سرور از دست رفته باشد، نسخهٔ بیرون از سرور را طبق [بخش ۸](#۸-پشتیبان-بیرون-از-سرور) باز کنید.

## ۶. کلیدها و تنظیمات مهم در `.env`

| تنظیم | توضیح |
|---|---|
| `OPENAI_API_KEY` | کلید OpenAI (فعلاً همهٔ کارهای AI با OpenAI انجام می‌شود) |
| `ANTHROPIC_API_KEY` | کلید Claude؛ بعد از گذاشتن، در سایت ← تنظیمات مدل‌ها را به Claude تغییر دهید |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ورود با جیمیل ([11-google-login.md](11-google-login.md)) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | کلیدهای امنیتی ورود؛ هرگز پاک یا عوض نکنید مگر عمداً |

اگر فقط بخشی از متغیرهای `GOOGLE_*` مقدار داشته باشد، دکمهٔ «ورود با گوگل» بی‌صدا پنهان می‌شود. از این پس `deploy.sh` در این حالت متوقف می‌شود و API هم هنگام شروع هشدار می‌دهد. `GOOGLE_CLIENT_SECRET` فقط در Google Cloud Console است (Credentials ← OAuth client). اگر از `.env` پاک شد، باید از همان‌جا دوباره برداشته شود.

## ۷. نکات امنیتی سرور
- هیچ پورتی از Contenter مستقیم روی اینترنت باز نیست؛ فقط از طریق HTTPS و Caddy در دسترس است (`docker-compose.override.yml`، که در git نیست).
- فایل `apps/api/.env` و پشتیبان‌هایش فقط برای کاربر `farhaad` قابل خواندن‌اند (`chmod 600`).

---

## ۸. پشتیبان بیرون از سرور

پشتیبان‌های `~/contenter-backups` روی همین سرورند؛ اگر سرور از دست برود، آن‌ها هم می‌روند. `scripts/backup.sh` هر شب (و در هر انتشار) از پایگاه داده، `.env` و فایل‌های بارگذاری‌شده (ولوم `uploads`، مثل فایل‌های برند) پشتیبان می‌گیرد، آن را **رمزنگاری** می‌کند و با [rclone](https://rclone.org) به یک فضای ذخیره‌سازی دیگر می‌فرستد. rclone لازم نیست نصب شود؛ اسکریپت در صورت نبودنش از ایمیج Docker آن استفاده می‌کند. نسخه‌های قدیمی‌تر از ۳۰ روز در مقصد خودکار پاک می‌شوند.

**مقصد پیشنهادی:** یک Object Storage سازگار با S3 داخل ایران (مثلاً آروان‌کلاد)، یا یک سرور دوم از طریق SFTP. سرویس‌های خارجی ممکن است از سرور در دسترس نباشند.

### راه‌اندازی (یک بار)

۱. کلید رمزنگاری و فایل تنظیمات را بسازید:

```bash
bash scripts/backup.sh setup
```

کلیدی که نشان می‌دهد را **بیرون از سرور** (مثلاً در یک password manager) ذخیره کنید. بدون این کلید، پشتیبان‌ها باز نمی‌شوند. کلید در `~/.contenter-backup-key` است.

۲. مقصد را در rclone تعریف کنید (نامش را `offsite` می‌گذاریم). برای S3 (مثلاً آروان‌کلاد؛ `access key`، `secret key` و `endpoint` را از پنل Object Storage بردارید):

```bash
bash scripts/backup.sh rclone config create offsite s3 provider ArvanCloud access_key_id <ACCESS_KEY> secret_access_key <SECRET_KEY> endpoint <ENDPOINT>
```

برای مقصدهای دیگر (SFTP، Google Drive و...) دستور تعاملی `bash scripts/backup.sh rclone config` را بزنید.

۳. فایل تنظیمات را باز کنید و مقصد را بنویسید (`<bucket>` نام باکتی است که در پنل ساخته‌اید):

```bash
nano ~/.contenter-backup.env
```

```
BACKUP_REMOTE=offsite:<bucket>/contenter
```

۴. یک پشتیبان بگیرید و بررسی کنید که باز می‌شود:

```bash
bash scripts/backup.sh
bash scripts/backup.sh test
```

پیام سبز `It can be restored` یعنی همه‌چیز درست است. پشتیبان شبانه (ساعت ۳:۱۷) را `deploy.sh` در اولین انتشار خودش فعال می‌کند (`bash scripts/backup.sh install-cron`)؛ حتی بدون مقصد بیرونی هم هر شب یک پشتیبان محلی گرفته می‌شود و گزارشش در `~/contenter-backups/backup.log` است. هر چند وقت یک بار `bash scripts/backup.sh test` را اجرا کنید.

### اگر ارسال شکست خورد
در انتشار (`deploy.sh`) فقط هشدار زرد `Off-site upload FAILED` نشان داده می‌شود و انتشار ادامه می‌یابد. تاریخ آخرین ارسال موفق در `~/contenter-backups/offsite-last-ok` است. آخر `backup.log` را برای Claude بفرستید:

```bash
tail -30 ~/contenter-backups/backup.log
```

### باز کردن یک پشتیبان بیرونی
روی سرور (یا یک سرور جدید با همین مخزن، فایل `~/.contenter-backup.env`، تنظیمات rclone و کلید):

```bash
bash scripts/backup.sh rclone lsf offsite:<bucket>/contenter   # فهرست نسخه‌ها
bash scripts/backup.sh fetch                                    # جدیدترین نسخه
bash scripts/backup.sh fetch contenter-20260930-031700.tar.gz.enc   # یک نسخهٔ مشخص
```

فایل‌ها در پوشهٔ `~/contenter-backups/restore-...` باز می‌شوند. خروجی یک `db-*.sql.gz` (پایگاه داده)، یک `env-*` (فایل تنظیمات) و یک `uploads-*.tar.gz` (فایل‌های بارگذاری‌شده) است. برای جایگزین کردن پایگاه داده با Claude هماهنگ کنید.

## ۹. انتشار خودکار از GitHub

بعد از هر تغییر روی شاخهٔ `main`، اگر تست‌ها (CI) سبز شوند، GitHub Actions با SSH به سرور وصل می‌شود و `scripts/deploy.sh` را برای **همان نسخه‌ای که تست شده** اجرا می‌کند (`.github/workflows/deploy.yml`). کلیدی که GitHub استفاده می‌کند **فقط** اجازهٔ اجرای `deploy.sh` را دارد: نه ترمینال، نه هیچ دستور دیگری.

### راه‌اندازی (یک بار)

۱. روی سرور:

```bash
cd ~/contenter
bash scripts/setup-auto-deploy.sh
```

۲. این دستور پنج مقدار چاپ می‌کند: `DEPLOY_HOST`، `DEPLOY_PORT`، `DEPLOY_USER`، `DEPLOY_KNOWN_HOSTS` و `DEPLOY_SSH_KEY`. در GitHub به مخزن ← **Settings** ← **Secrets and variables** ← **Actions** ← **New repository secret** بروید و هر کدام را با همان نام و مقدار اضافه کنید. برای `DEPLOY_SSH_KEY` همهٔ خطوط، از `-----BEGIN` تا `-----END ... KEY-----`، را کپی کنید. `DEPLOY_HOST` باید `82.115.8.115` باشد؛ اگر چیز دیگری نشان داد، دستور را این‌طور دوباره بزنید: `DEPLOY_HOST=82.115.8.115 bash scripts/setup-auto-deploy.sh`.

۳. آزمایش: GitHub ← **Actions** ← **Deploy** ← **Run workflow** (روی `main`). در لاگ آن باید همان خروجی `deploy.sh` و در پایان `Deploy finished` را ببینید.

### نکته‌ها
- تا این secretها اضافه نشوند، workflow فقط یک هشدار نشان می‌دهد و کاری نمی‌کند.
- انتشارها پشت سر هم اجرا می‌شوند، نه هم‌زمان. سرور هیچ‌وقت به نسخهٔ قدیمی‌تر برنمی‌گردد.
- اگر سرور از GitHub در دسترس نباشد (مثلاً به خاطر محدودیت شبکه)، مرحلهٔ Deploy با `Connection timed out` قرمز می‌شود. در این حالت انتشار دستی (`bash scripts/deploy.sh`) مثل قبل کار می‌کند.
- **خاموش کردن:** secret `DEPLOY_SSH_KEY` را در GitHub پاک کنید، یا روی سرور خطی که با `contenter-github-deploy` تمام می‌شود را از `~/.ssh/authorized_keys` حذف کنید. برای ساختن کلید جدید، `setup-auto-deploy.sh` را دوباره بزنید؛ کلید قبلی خودکار باطل می‌شود.
