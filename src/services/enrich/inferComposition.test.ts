import { describe, expect, it } from 'vitest';

import { inferComposition } from '@/services/enrich/inferComposition';

/**
 * The strings in this block are quoted from pages the app scraped, not written
 * to suit the implementation. They are the reason the patterns look the way
 * they do — particularly Stumptown's "SINGLE ORGIN", which is a live typo on a
 * page in the user's own library.
 */
describe('inferComposition, against real roaster pages', () => {
  it('reads Stumptown Holler Mountain as a blend', () => {
    expect(
      inferComposition({
        name: 'Holler Mountain Blend – Whole Bean Coffee | Stumptown Coffee Roasters',
      })?.composition,
    ).toBe('blend');
  });

  it('reads Stumptown Hair Bender as a blend', () => {
    expect(
      inferComposition({ name: 'Hair Bender Coffee Blend | Stumptown Coffee Roasters' })
        ?.composition,
    ).toBe('blend');
  });

  it('reads Counter Culture Fast Forward as a blend', () => {
    expect(
      inferComposition({ name: 'Fast Forward', roasterDescription: 'Year-Round Blend' })
        ?.composition,
    ).toBe('blend');
  });

  it('reads Stumptown Sunrider as a single origin, though the shop files it under Blends', () => {
    expect(inferComposition({ pageText: 'EXCLUSIVE SINGLE ORIGIN Sunrider' })?.composition).toBe(
      'single-origin',
    );
  });

  it('survives Stumptown\'s own "SINGLE ORGIN" typo', () => {
    expect(
      inferComposition({ pageText: 'SINGLE ORGIN Honduras El Puente Natural' })?.composition,
    ).toBe('single-origin');
  });

  it('says nothing about Blue Bottle Night Light Decaf, whose page says neither word', () => {
    expect(
      inferComposition({
        name: 'Night Light Decaf',
        roasterDescription: 'Chocolate, toasted marshmallow, and a soft citrus finish.',
      }),
    ).toBeUndefined();
  });
});

describe('inferComposition', () => {
  it('matches a hyphenated single-origin', () => {
    expect(inferComposition({ name: 'Ethiopia Guji single-origin' })?.composition).toBe(
      'single-origin',
    );
  });

  it('reports the phrase it matched', () => {
    expect(inferComposition({ name: 'House Blend' })?.evidence).toBe('blend');
  });

  it('ignores a composition the copy says the coffee is not', () => {
    expect(inferComposition({ roasterDescription: 'Not your typical espresso blend.' })).toBe(
      undefined,
    );
  });

  it('still reads a plain statement in the sentence after a negation', () => {
    expect(
      inferComposition({
        roasterDescription: 'We do not cut corners. This is our flagship blend.',
      })?.composition,
    ).toBe('blend');
  });

  it('abstains when a contrast puts both words inside one negation', () => {
    expect(
      inferComposition({
        roasterDescription: 'Unlike a single origin, this blend stays consistent all year.',
      }),
    ).toBeUndefined();
  });

  it('abstains when both words are asserted in the same scope', () => {
    expect(
      inferComposition({
        pageText: 'Our blend of the month sits beside a single origin from Peru.',
      }),
    ).toBeUndefined();
  });

  it('lets the name decide even when the wider page mentions both', () => {
    expect(
      inferComposition({
        name: 'Hair Bender Blend',
        pageText: 'Shop our blends and our single origins.',
      })?.composition,
    ).toBe('blend');
  });

  it('does not read "blended" as a statement about composition', () => {
    expect(
      inferComposition({ roasterDescription: 'Delicious blended with steamed milk.' }),
    ).toBeUndefined();
  });

  it('returns nothing when it has no text at all', () => {
    expect(inferComposition({})).toBeUndefined();
  });

  it('skips empty scopes rather than treating them as answers', () => {
    expect(
      inferComposition({ name: '   ', roasterDescription: 'A classic blend.' })?.composition,
    ).toBe('blend');
  });
});
