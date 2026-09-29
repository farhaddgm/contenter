# ورود با گوگل (جیمیل)

Contenter دو روش ورود دارد:

1. **ایمیل و رمز عبور** (روش قبلی)
2. **ورود با گوگل**: فقط برای حساب‌های **‎@gmail.com** که مالک به آن‌ها دسترسی داده است

## صفحه‌های ورود

| مسیر | روش‌ها |
|---|---|
| `/auth/login` | فقط «ورود با گوگل». این صفحهٔ پیش‌فرض است: خروج از حساب، پایان نشست و تغییر رمز به آن برمی‌گردند. |
| `/auth/login-up` | ایمیل و رمز عبور، و همچنین گوگل (اگر پیکربندی شده باشد). |

`/auth/login-up` صفحه‌ای مخفی است. هیچ جای اپ به آن لینک نمی‌دهد و فقط با تایپ کردن آدرس باز می‌شود. عمداً در `robots.txt` نیامده، چون آن فایل عمومی است و آدرس را لو می‌دهد. به‌جایش nginx هدر `X-Robots-Tag: noindex, nofollow` می‌فرستد و خود صفحه هم متای `robots` را اضافه می‌کند. این فقط پنهان کردن آدرس است، نه یک لایهٔ امنیتی: API ورود با رمز (`POST /api/auth/login`) همچنان عمومی است.

## مالک

- مالک برنامه با متغیر `OWNER_EMAIL` تعیین می‌شود (پیش‌فرض: `farhad.dgm@gmail.com`).
- اولین بار که مالک با گوگل وارد شود، حسابش خودکار ساخته می‌شود (نقش **مدیر**، روش «فقط جیمیل»). اگر از قبل کاربری با همین ایمیل وجود داشته باشد، همان حساب استفاده می‌شود.
- مالک همیشه با گوگل وارد می‌شود و هنگام ورود، نقشش مدیر و حسابش فعال می‌شود.
- هیچ مدیر دیگری نمی‌تواند حساب مالک را ویرایش یا غیرفعال کند، یا کاربری با ایمیل مالک بسازد.
- بخش **«تنظیمات ← ورود با جیمیل»** فقط برای مالک نمایش داده می‌شود. API آن (`/api/owner/*`) هم با `OwnerGuard` محافظت می‌شود.

## فهرست مجاز (Allowlist)

در بخش «ورود با جیمیل»، مالک حساب‌های جیمیل را اضافه می‌کند و برای هر نفر این‌ها را مشخص می‌کند:

| فیلد | توضیح |
|---|---|
| جیمیل | فقط ‎@gmail.com. اگر کاربری با همین ایمیل وجود داشته باشد، به همان حساب دسترسی داده می‌شود و حساب تکراری ساخته نمی‌شود. |
| نام، نقش | مثل صفحهٔ کاربران |
| روش ورود | **فقط جیمیل** (`GOOGLE`): رمز عبور ندارد و رمز قبلی حذف می‌شود.<br>**جیمیل و رمز عبور** (`BOTH`): هر دو روش کار می‌کند. اگر حساب هنوز رمز نداشته باشد، باید رمز تعیین شود. |
| فعال | با غیرفعال کردن، همهٔ نشست‌های کاربر باطل می‌شوند. |

با **حذف دسترسی جیمیل**، روش ورود کاربر به `PASSWORD` برمی‌گردد و نشست‌هایش بسته می‌شوند. اگر حساب رمز عبور نداشته باشد، غیرفعال می‌شود.

هر جیمیلی که در این فهرست نباشد (یا روش ورودش `PASSWORD` باشد) با خطای «اجازهٔ ورود ندارد» برمی‌گردد. کاربرانی که مدیرهای دیگر در صفحهٔ کاربران می‌سازند، روش ورودشان `PASSWORD` است و فقط مالک می‌تواند ورود با گوگل را برایشان فعال کند.

## مدل داده

فیلدهای جدید در `User`:

- `loginMethod`: `PASSWORD` | `GOOGLE` | `BOTH` (پیش‌فرض `PASSWORD`)
- `passwordHash`: برای حساب‌های «فقط جیمیل» خالی (null) است
- `googleSub`: شناسهٔ حساب گوگل که در اولین ورود ثبت می‌شود. پس از آن، اگر حساب گوگل دیگری با همان آدرس وارد شود، رد می‌شود (محافظت در برابر آدرس بازیافتی).

در مقایسهٔ آدرس‌ها، نقطه‌ها، پسوند `+tag` و بزرگی و کوچکی حروف نادیده گرفته می‌شوند، و `googlemail.com` با `gmail.com` یکی حساب می‌شود (`normalizeGmail`). به همین دلیل `farhad.dgm@gmail.com` و `farhaddgm@gmail.com` یک حساب به‌حساب می‌آیند.

## جریان فنی (OpenID Connect + PKCE)

```
مرورگر ── GET /api/auth/google?redirectTo=/app ──► API
   API: state + PKCE verifier + nonce را در کوکی امضاشدهٔ contenter_goauth (۱۰ دقیقه) می‌گذارد
   ◄── 302 به accounts.google.com (prompt=select_account)
کاربر حساب جیمیلِ لاگین‌شده در مرورگر را انتخاب می‌کند
Google ── 302 ──► GET /api/auth/google/callback?code&state
   API: بررسی state → تبادل code (با client_secret و verifier) → تأیید امضای id_token با JWKS گوگل
        و بررسی iss/aud/exp/nonce و email_verified → بررسی فهرست مجاز → صدور کوکی refresh
   ◄── 302 به APP_URL + redirectTo  (اپ با /auth/refresh نشست را برمی‌گرداند)
در صورت خطا: 302 به /auth/login?error=<code>
```

کدهای خطا (`GoogleLoginError`): `not_configured`، `cancelled`، `expired`، `not_gmail`، `not_allowed`، `inactive`، `failed`. صفحهٔ ورود متن فارسی هرکدام را نشان می‌دهد. هر ورود موفق یا ناموفق در لاگ ممیزی ثبت می‌شود (`auth.login` / `auth.login_failed` با `method: google`). تغییرات فهرست مجاز هم با `google_access.grant|update|revoke` ثبت می‌شوند.

`redirectTo` فقط مسیر نسبی داخل همین اپ را می‌پذیرد (جلوی open redirect گرفته می‌شود).

## API

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/auth/providers` | عمومی. خروجی `{ google: boolean }`: دکمهٔ گوگل فقط وقتی پیکربندی کامل باشد نمایش داده می‌شود |
| GET | `/auth/google` | عمومی. شروع ورود (ناوبری کامل صفحه، نه fetch) |
| GET | `/auth/google/callback` | عمومی. بازگشت از گوگل |
| GET | `/owner/google-access` | فقط مالک. فهرست جیمیل‌های مجاز |
| POST | `/owner/google-access` | فقط مالک. `{ email, name, role, loginMethod: GOOGLE\|BOTH, password? }` |
| PATCH | `/owner/google-access/:id` | فقط مالک. `{ name?, role?, isActive?, loginMethod?, password? }` |
| DELETE | `/owner/google-access/:id` | فقط مالک. حذف دسترسی جیمیل |

## راه‌اندازی در Google Cloud

1. در [Google Cloud Console](https://console.cloud.google.com/) یک پروژه بسازید (یا پروژهٔ موجود را انتخاب کنید).
2. **APIs & Services ← OAuth consent screen**: نوع **External** را انتخاب کنید و نام برنامه و ایمیل پشتیبانی را وارد کنید. scopeهای `openid`، `email` و `profile` کافی‌اند (حساس نیستند و verification لازم ندارند).
   - اگر برنامه در حالت **Testing** بماند، فقط «Test users» تعریف‌شده می‌توانند وارد شوند. یا جیمیل‌ها را آنجا هم اضافه کنید، یا برنامه را **Publish** کنید. کنترل دسترسی اصلی همان فهرست مجاز Contenter است.
3. **Credentials ← Create credentials ← OAuth client ID**، نوع **Web application**:
   - Authorized redirect URI: `https://contenter.beeproject.ir/api/auth/google/callback`
   - برای توسعهٔ محلی: `http://localhost:5173/api/auth/google/callback`
4. مقادیر را در `apps/api/.env` قرار دهید:

```env
APP_URL=https://contenter.beeproject.ir
OWNER_EMAIL=farhad.dgm@gmail.com
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
GOOGLE_REDIRECT_URI=https://contenter.beeproject.ir/api/auth/google/callback
```

5. migration را اجرا کنید (`prisma migrate deploy` هنگام شروع API خودکار اجرا می‌شود) و API را ری‌استارت کنید.

سرور API باید بتواند به `oauth2.googleapis.com` و `www.googleapis.com` درخواست بفرستد. مرورگر کاربر هم باید به `accounts.google.com` دسترسی داشته باشد.
