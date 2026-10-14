# سلامت عمیق و متریک عملیاتی

> وضعیت: **پیاده‌سازی‌شده** (گام ۳۹ از [29-roadmap-50-steps.md](29-roadmap-50-steps.md)). همه با کد و شمارش؛ هیچ AI ندارد. پیاده‌سازی کامل OpenTelemetry جدا و بعداً است.

`GET /api/health` فقط دیتابیس و Redis را می‌پرسید. «ورکر مرده است» یا «صف گیر کرده» دیده نمی‌شد. حالا هر دو را می‌بیند و برای ابزارهای پایش یک `/api/metrics` هست.

## نبض ورکر

هر پردازشی که ورکر BullMQ را اجرا می‌کند (`APP_ROLE=worker` یا `all`) هر **۳۰ ثانیه** یک کلید Redis به نام `contenter:worker:<hostname>:<pid>` با انقضای **۹۰ ثانیه** می‌نویسد. اگر پردازش یا حلقهٔ رویدادش بمیرد، کلید ظرف ۹۰ ثانیه می‌افتد؛ خاموش‌شدن عمدی کلید را همان لحظه پاک می‌کند. API با یک `SCAN` تعداد نبض‌های زنده را می‌شمارد. نبض نشان می‌دهد پردازش زنده است، نه اینکه هر کار AI درست انجام می‌شود.

## `GET /api/health` (عمومی)

فیلدهای تازه (افزایشی؛ `db`، `redis`، `restoreCheck`، `lastRestoreVerifiedAt`، `time` مثل قبل):

```json
{ "status": "ok", "db": true, "redis": true,
  "worker": "ok",
  "queue": { "waiting": 0, "oldestWaitingSeconds": null, "stuck": 0 } }
```

- `worker`: `ok` (نبض زنده)، `down` (هیچ نبضی)، `na` (صف `inline` که ورکر جدا ندارد).
- `queue`: کارهای منتظر (`QUEUED`)، سن قدیمی‌ترین کار منتظر، و کارهای `RUNNING` بیش از ۳۰ دقیقه. از جدول `AiJob` خوانده می‌شود، پس با هر دو درایور درست است. فقط عدد؛ هیچ جزئیات کار، نام یا ورودی‌ای نیست.
- **`status = degraded`** وقتی: دیتابیس یا Redis در دسترس نیست؛ یا هیچ ورکری زنده نیست؛ یا قدیمی‌ترین کار منتظر بیش از **۱۵ دقیقه** است. کار گیرکرده فقط عدد است و وضعیت را قرمز نمی‌کند (یک تماس کند به مدل نباید کل سرویس را قرمز کند).
- **مهلت راه‌اندازی:** نبودِ ورکر تا ۱۸۰ ثانیه پس از شروع API `degraded` حساب نمی‌شود، تا `scripts/deploy.sh` (که تا ۱۵۰ ثانیه منتظر `status: ok` می‌ماند) به‌خاطر ورکری که هنوز بالا می‌آید شکست نخورد. آستانه‌ها ثابت‌های `QUEUE_STALLED_SECONDS`، `JOB_STUCK_SECONDS`، `WORKER_STARTUP_GRACE_SECONDS` در `packages/shared/src/ops.ts` هستند و یک تست رابطهٔ مهلت با اسکریپت استقرار را نگه می‌دارد.

## `GET /api/metrics` (با توکن جدا)

قالب Prometheus (متن ساده، نسخهٔ 0.0.4). **هرگز عمومی نیست:**

- با `METRICS_TOKEN` در `apps/api/.env` (دست‌کم ۳۲ نویسه؛ `openssl rand -hex 32`) روشن می‌شود و هر درخواست باید `Authorization: Bearer <token>` بدهد. بدون توکن مسیر **وجود ندارد (۴۰۴)**؛ توکن غلط ۴۰۱. اگر با `INTEGRATION_TOKEN` یا `RESEARCHER_INTEGRATION_TOKEN` یکی باشد هم ۴۰۴ می‌ماند (یک راز لو‌رفته دو در را باز نکند).
- راه امن‌تر: مسیر را در پراکسی فقط به شبکهٔ داخلی بدهید و از بیرون نبندید/ببندید.

| متریک | معنا |
| --- | --- |
| `contenter_up` | API پاسخ می‌دهد |
| `contenter_queue_driver{driver}` | درایور صف |
| `contenter_workers_alive`، `contenter_worker_ok` | شمار نبض‌ها / ۱ یا ۰ (برای `inline` نیست) |
| `contenter_ai_jobs_waiting`، `…_oldest_waiting_seconds`، `…_stuck` | عمق و سن صف، کار گیرکرده |
| `contenter_ai_jobs_pending{type,status}` | کارهای منتظر و در حال اجرا به تفکیک نوع کار |
| `contenter_ai_jobs_finished_window{status,window="24h"}` | کارهای تمام‌شدهٔ ۲۴ ساعت اخیر به تفکیک وضعیت (نرخ شکست) |
| `contenter_ai_job_duration_seconds{quantile,window}` | چارک‌های ۰٫۵ / ۰٫۹ / ۰٫۹۹ زمان اجرای کارهای موفق (تا ۵۰۰۰ کار) |
| `contenter_ai_cost_usd_window`، `contenter_ai_tokens_window{type="input\|output"}` | هزینه و توکن |
| `contenter_app_errors_open_window` | گروه‌های خطای باز دیده‌شده در ۲۴ ساعت ([10](10-smart.md)) |
| `contenter_restore_check_ok`، `contenter_restore_check_age_seconds` | بررسی هفتگی بازیابی ([13](13-operations.md)) |

همه گیج (gauge) و از جدول‌ها خوانده می‌شوند، نه از شمارندهٔ حافظه، پس با ری‌استارت صفر نمی‌شوند. **برچسب‌ها فقط** `type` (نوع کار)، `status`، `window`، `quantile`، `driver` هستند؛ شناسهٔ کاربر، کسب‌وکار یا پروژه هرگز نمی‌آید و `renderPrometheus` برچسب دیگری را خطا می‌دهد (تست).

نمونهٔ Prometheus:

```yaml
scrape_configs:
  - job_name: contenter
    metrics_path: /api/metrics
    authorization: { credentials_file: /etc/prometheus/contenter-token }
    static_configs: [{ targets: ['api:4000'] }]
```

## هشدار

قواعد نمونه برای Alertmanager در [`alerts/contenter.rules.yml`](alerts/contenter.rules.yml): API پاسخ نمی‌دهد، ورکر مرده، صف بیش از ۱۵ دقیقه جلو نمی‌رود، کار گیرکرده، نرخ شکست بالا، جهش هزینه، شکست و کهنگی بررسی بازیابی. چیزی خودکار نصب نمی‌شود و آستانه‌ها (مثل بودجهٔ روزانه) را باید خودتان بگذارید.

## محدودیت‌ها

- نبض ورکر زنده‌بودن پردازش است، نه سلامت هر کار؛ برای آن `oldest_waiting` و `stuck` هستند.
- `contenter_ai_job_duration_seconds` روی ۵۰۰۰ کار آخر ۲۴ ساعت است؛ برای حجم بیشتر تقریبی می‌شود.
- هیچ ردیابی توزیع‌شده (OpenTelemetry) نیست؛ فقط این گیج‌ها و `/api/health`.
