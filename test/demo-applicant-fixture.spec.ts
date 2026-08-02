import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_BASE_APPLICANT } from '../src/modules/seeding/data/demo-workflow';

/** Keeps the live smoke fixture identical to the applicant used to seed passing regressions. */
describe('demo applicant fixture', () => {
  it('matches the seeded low-risk applicant contract', () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), 'smoke', 'demo-applicant.json'), 'utf8'),
    );
    expect(fixture).toEqual(DEMO_BASE_APPLICANT);
  });
});
