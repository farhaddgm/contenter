import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// The Prisma delegates that belong to a business's identity (docs/63-business-boundary.md).
const BUSINESS_DELEGATES =
  '^business(Member|Section|SectionRevision|Suggestion|Discovery|Reference|Note|Asset|Fact|Term|Audit|Style|Offering|Segment|Competitor|CompetitorSource|QuestionSkip)?$|^styleSource$|^offeringSegment$';
const CLIENT = '^(prisma|tx)$';
const BUSINESS_TABLE_MESSAGE =
  'Business tables are read through BusinessApi (modules/businesses/business-api.ts), not queried directly. See docs/63-business-boundary.md.';

export default tseslint.config(
  { ignores: ['dist', 'prisma/migrations'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `prisma.business…` / `this.prisma.business…` / `tx.business…` outside the allowed files
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[property.name=/${BUSINESS_DELEGATES}/][object.name=/${CLIENT}/]`,
          message: BUSINESS_TABLE_MESSAGE,
        },
        {
          selector: `MemberExpression[property.name=/${BUSINESS_DELEGATES}/][object.property.name=/${CLIENT}/]`,
          message: BUSINESS_TABLE_MESSAGE,
        },
      ],
    },
  },
  {
    // Allowed to touch the business tables directly (the explicit list from docs/63 §5):
    //  - the module that owns them and the facade itself
    //  - the business AI runners (they persist what the model returned, per the core rule)
    //  - access control (reading the owner/members of a record) and the owner's grants
    //  - specs, which mock the client
    files: [
      'src/modules/businesses/**',
      'src/modules/ai/runners/business.runners.ts',
      'src/modules/ai/runners/business-extra.runners.ts',
      'src/modules/ai/runners/business-style.runner.ts',
      'src/modules/ai/runners/business-offerings.runner.ts',
      'src/modules/ai/runners/embed-reference.runner.ts',
      'src/common/access.ts',
      'src/modules/users/users.module.ts',
      '**/*.spec.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
