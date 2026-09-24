/* Idempotent seed: admin user, default prompt templates (v1), global principles and a demo topic. */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_PROMPTS } from '../src/modules/ai/prompts/defaults';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@contenter.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'مدیر سیستم',
      role: 'ADMIN',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  console.log(`✔ admin: ${admin.email}`);

  for (const p of DEFAULT_PROMPTS) {
    const exists = await prisma.promptTemplate.findFirst({ where: { key: p.key } });
    if (!exists) {
      await prisma.promptTemplate.create({
        data: {
          key: p.key,
          version: 1,
          system: p.system,
          user: p.user,
          notes: p.notes,
          isActive: true,
        },
      });
      console.log(`✔ prompt ${p.key} v1`);
    }
  }

  if ((await prisma.principle.count({ where: { topicId: null } })) === 0) {
    await prisma.principle.createMany({
      data: [
        {
          kind: 'MUST',
          text: 'اطلاعات باید دقیق و قابل‌راستی‌آزمایی باشد؛ هیچ آمار یا ادعایی ساختگی نباشد.',
          order: 0,
        },
        { kind: 'AVOID', text: 'از عبارات کلیشه‌ای و اغراق‌آمیز تبلیغاتی پرهیز شود.', order: 1 },
        {
          kind: 'PREFER',
          text: 'فارسی روان و معیار، با پرهیز از واژه‌های بیگانهٔ غیرضروری.',
          order: 2,
        },
      ],
    });
    console.log('✔ global principles');
  }

  if ((await prisma.topic.count()) === 0) {
    await prisma.topic.create({
      data: {
        title: 'آموزش سرمایه‌گذاری برای تازه‌کارها',
        description:
          'محتوای آموزشی کوتاه برای افرادی که تازه می‌خواهند با مفاهیم پایهٔ سرمایه‌گذاری و مدیریت مالی شخصی آشنا شوند. هدف، ساده‌سازی مفاهیم و ایجاد عادت‌های مالی درست است.',
        audience: 'جوانان ۲۰ تا ۳۵ ساله بدون دانش مالی قبلی',
        platform: 'INSTAGRAM',
        language: 'fa',
        createdById: admin.id,
        principles: {
          create: [
            { kind: 'MUST', text: 'هر محتوا فقط یک مفهوم اصلی را آموزش دهد.', order: 0 },
            { kind: 'AVOID', text: 'توصیهٔ خرید یا فروش دارایی مشخص ممنوع است.', order: 1 },
          ],
        },
      },
    });
    console.log('✔ demo topic');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
