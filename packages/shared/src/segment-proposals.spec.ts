import { describe, expect, it } from 'vitest';
import {
  resolveSegmentProposals,
  type SegmentsPropose,
} from './business-segments';

type Proposal = SegmentsPropose['segments'][number];

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  kind: 'PERSONA',
  name: 'کارمند حقوق‌بگیر',
  summary: 'فردی با حقوق ثابت',
  goals: ['خرید لپ‌تاپ'],
  pains: ['وثیقه'],
  objections: ['سود بالا'],
  channels: ['اینستاگرام'],
  messageAngle: 'بدون وثیقه',
  offerings: [],
  evidence: 'کارمندان با حقوق ثابت می‌توانند وام بگیرند',
  ...over,
});

const sources = ['مخاطب اصلی ما: کارمندان با حقوق ثابت می‌توانند وام بگیرند و نیازی به وثیقه ندارند.'];
const offerings = [
  { id: 'o1', name: 'تسهیلات تجهیزات', aliases: ['وام تجهیزات'] },
  { id: 'o2', name: 'تسهیلات مسکن', aliases: [] },
];
const base = { sources, existing: [], offerings, room: 10 };

describe('resolveSegmentProposals', () => {
  it('keeps an audience whose quote really occurs in a source, with its fields', () => {
    const out = resolveSegmentProposals({ ...base, proposals: [proposal()] });
    expect(out.dropped).toEqual([]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      kind: 'PERSONA',
      name: 'کارمند حقوق‌بگیر',
      pains: ['وثیقه'],
      messageAngle: 'بدون وثیقه',
      links: [],
    });
  });

  it('matches the quote however digits, letters and punctuation are written', () => {
    const out = resolveSegmentProposals({
      ...base,
      sources: ['حقوق ثابت ۱۲ ماه، وثیقه لازم نیست!'],
      proposals: [proposal({ evidence: 'حقوق ثابت 12 ماه وثیقه لازم نیست' })],
    });
    expect(out.rows).toHaveLength(1);
  });

  it('drops an audience whose quote is not in the sources, or too short to prove anything', () => {
    const out = resolveSegmentProposals({
      ...base,
      proposals: [proposal({ name: 'ساختگی', evidence: 'این جمله هیچ‌جا نیست' }), proposal({ name: 'کوتاه', evidence: 'ثابت' })],
    });
    expect(out.rows).toEqual([]);
    expect(out.dropped).toEqual([
      { name: 'ساختگی', reason: 'NO_EVIDENCE' },
      { name: 'کوتاه', reason: 'NO_EVIDENCE' },
    ]);
  });

  it('does not need the audience name to occur in the sources (a persona is a label)', () => {
    const out = resolveSegmentProposals({ ...base, proposals: [proposal({ name: 'سارا، کارمند' })] });
    expect(out.rows[0]?.name).toBe('سارا، کارمند');
  });

  it('drops an empty name, a name already stored or repeated, and what does not fit', () => {
    const out = resolveSegmentProposals({
      ...base,
      existing: ['کارمند حقوق بگیر'],
      room: 1,
      proposals: [
        proposal({ name: '  ' }),
        proposal({ name: 'کارمند حقوق‌بگیر' }),
        proposal({ name: 'اول' }),
        proposal({ name: 'اول' }),
        proposal({ name: 'دوم' }),
      ],
    });
    expect(out.rows.map((r) => r.name)).toEqual(['اول']);
    expect(out.dropped.map((d) => d.reason)).toEqual(['NO_NAME', 'DUPLICATE', 'DUPLICATE', 'LIMIT']);
  });

  it('links only offerings that exist, by name or alias, once each, main unless told secondary', () => {
    const out = resolveSegmentProposals({
      ...base,
      proposals: [
        proposal({
          offerings: [
            { name: 'وام تجهیزات', fit: 2 },
            { name: 'تسهیلات تجهیزات', fit: 1 },
            { name: 'تسهیلات مسکن', fit: 1 },
            { name: 'تسهیلات خودرو', fit: 2 },
            { name: 'تسهیلات مسکن', fit: 7 },
          ],
        }),
      ],
    });
    expect(out.rows[0]!.links).toEqual([
      { offeringId: 'o1', fit: 2 },
      { offeringId: 'o2', fit: 1 },
    ]);
    expect(out.unknownOfferings).toEqual(['تسهیلات خودرو']);
  });

  it('trims fields to their limits and drops empty or repeated points', () => {
    const long = 'ب'.repeat(900);
    const out = resolveSegmentProposals({
      ...base,
      proposals: [
        proposal({
          summary: long,
          messageAngle: long,
          pains: ['a', 'a', '  ', 'b', 'c', 'd', 'e', 'f', 'g'],
          goals: ['x'.repeat(500)],
        }),
      ],
    });
    const row = out.rows[0]!;
    expect(row.summary).toHaveLength(400);
    expect(row.messageAngle).toHaveLength(400);
    expect(row.pains).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(row.goals[0]).toHaveLength(200);
  });
});
