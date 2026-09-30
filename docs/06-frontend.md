# فرانت‌اند

معماری فرانت‌اند از [bulletproof-react](https://github.com/alan2207/bulletproof-react) الگو گرفته است: ساختار feature-based، جریان یک‌طرفهٔ وابستگی‌ها و لایهٔ API جدا.

## ساختار `apps/web/src`

```
app/          # نقطهٔ ترکیب: provider، router (lazy routes)، صفحات
  routes/     # هر صفحه فقط featureها را کنار هم می‌گذارد
components/   # UI مشترک: ui/ (Button، Dialog، Drawer، Table…)، layouts/، errors/
config/       # env و paths (نقشهٔ مسیرها؛ URL هیچ‌جا مستقیم نوشته نمی‌شود)
features/     # topics، samples، profiles، ideas، contents، jobs، principles، dashboard، admin
  <feature>/api/         # هوک‌های TanStack Query و query keys
  <feature>/components/  # کامپوننت‌های همان دامنه
hooks/ lib/ stores/ i18n/ utils/ testing/
```

**قاعدهٔ وابستگی:** `shared → features → app`. هیچ کدی خارج از `app/` از `app/` import نمی‌کند (ESLint این را اجبار می‌کند).

## الگوهای کلیدی

- **داده‌های سرور:** TanStack Query. هر feature کلیدهای query خودش را دارد، مثل `topicKeys` و `contentKeys`.
- **کارهای AI:** هوک `useTrackJob(jobId, { invalidate })` وضعیت کار را poll می‌کند و پس از پایان، کوئری‌های مرتبط را invalidate و اعلان نشان می‌دهد. لیست‌ها هم تا وقتی آیتمی در وضعیت `GENERATING` یا `QUEUED` باشد خودکار refetch می‌شوند.
- **احراز هویت:** توکن دسترسی فقط در حافظه (zustand) نگه داشته می‌شود. `AuthLoader` هنگام شروع نشست را از کوکی refresh بازیابی می‌کند. `api-client` روی 401 یک بار refresh می‌کند (single-flight) و درخواست را تکرار می‌کند.
- **مجوزها:** `useAuthorization().can(policy)` و کامپوننت `<Authorization policy="…">`. سیاست‌ها `content:write`، `backoffice:access` و `topic:delete` هستند.
- **فرم‌ها:** react-hook-form با `zodResolver` و همان اسکیماهای مشترک بک‌اند.
- **دیالوگ‌ها:** فرم‌های ایجاد و ویرایش در Drawer کناری هستند (الگوی FormDrawer در bulletproof). دیالوگ‌های دارای state فقط هنگام باز بودن mount می‌شوند.
- **i18n و RTL:** دیکشنری تایپ‌شده در `i18n/fa.ts` (مرجع کلیدها) و `i18n/en.ts`. تابع `useT()` کلید نادرست را در زمان کامپایل خطا می‌دهد. `dir` و `lang` روی `<html>` همگام می‌شوند و در استایل‌ها از خواص منطقی (`ps-`، `me-`، `start-`) استفاده شده است.
- **پوسته:** توکن‌های رنگی در `index.css` برای حالت روشن و تیره. فونت Vazirmatn است.

## صفحات

| مسیر | صفحه |
|---|---|
| `/auth/login` | ورود، فقط با گوگل (جیمیل) |
| `/auth/login-up` | ورود با ایمیل و رمز عبور و همچنین گوگل. هیچ لینکی به آن نیست و `noindex` است ([11-google-login.md](11-google-login.md)) |
| `/app` | داشبورد: آمار، نمودار فعالیت، وضعیت محتواها، هزینهٔ AI |
| `/app/businesses` | کسب‌وکارها: فهرست، ایجاد دستی، «ساخت خودکار با AI» و تحقیق‌های اخیر |
| `/app/businesses/:id` | پروفایل کسب‌وکار: ۱۵ بخش گروه‌بندی‌شده با نوشتن/پیشنهاد AI/تأیید/تاریخچه، بررسی کیفیت با AI، سلامت پروفایل، واقعیت‌ها و واژه‌نامه، تکمیل با تحقیق وب، پروژه‌های متصل، منابع ([16-business-profile-quality.md](16-business-profile-quality.md)) |
| `/app/businesses/discover/:id` | نتیجهٔ تحقیق کلیدواژه و تأیید کاندیدا ([12-businesses.md](12-businesses.md)) |
| `/app/topics` | موضوع‌ها (جست‌وجو، فیلتر، ایجاد؛ انتخاب کسب‌وکار در فرم) |
| `/app/topics/:id/:tab` | تب‌های نمای کلی، اصول، نمونه‌ها، پروفایل سبک، ایده‌ها و محتواها |
| `/app/contents` و `/app/contents/:id` | فهرست و ویرایشگر محتوا (نسخه‌ها، خودارزیابی، بازنویسی، تأیید) |
| `/app/account` | حساب و تغییر رمز |
| `/app/admin/*` | بک‌آفیس (جزئیات در [07-backoffice.md](07-backoffice.md)) |

## افزودن یک feature جدید
1. پوشهٔ `src/features/<name>/api` را با هوک‌های Query و Mutation بسازید.
2. کامپوننت‌ها را در `src/features/<name>/components` قرار دهید.
3. مسیر را به `config/paths.ts` و `app/router.tsx` (به‌صورت lazy) اضافه کنید.
4. کلیدهای ترجمه را در `fa.ts` تعریف کنید. `en.ts` تا زمانی که کلیدها کامل نشده باشند کامپایل نمی‌شود.
