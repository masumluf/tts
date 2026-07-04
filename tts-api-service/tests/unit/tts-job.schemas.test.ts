import { createTtsJobSchema } from '../../src/jobs/tts-job.schemas';

describe('createTtsJobSchema (Bengali validation)', () => {
  it('accepts valid Bengali text', () => {
    const result = createTtsJobSchema.safeParse({ text: 'আপনার অডিও তৈরি হচ্ছে।' });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    expect(createTtsJobSchema.safeParse({ text: '' }).success).toBe(false);
    expect(createTtsJobSchema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('rejects non-Bengali text', () => {
    expect(createTtsJobSchema.safeParse({ text: 'hello world' }).success).toBe(false);
  });

  it('rejects a missing/invalid payload', () => {
    expect(createTtsJobSchema.safeParse({}).success).toBe(false);
    expect(createTtsJobSchema.safeParse({ text: 123 }).success).toBe(false);
  });
});
