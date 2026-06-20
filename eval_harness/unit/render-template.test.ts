/**
 * Unit tests for the pure template renderer (F4b). No DB, no LLM.
 * Contract: fill whitelisted {{tokens}} with non-empty values; leave unknown /
 * empty tokens literal and report them in `unresolved`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate,
  TEMPLATE_PLACEHOLDERS
} from '../../lib/agent/templates/render-template.ts';

describe('renderTemplate', () => {
  it('fills whitelisted tokens with provided values', () => {
    const { rendered, unresolved } = renderTemplate(
      'Bonjour {{name}}, à propos de {{listing_title}}.',
      { name: 'Duc', listing_title: 'Studio Montmartre' }
    );
    assert.equal(rendered, 'Bonjour Duc, à propos de Studio Montmartre.');
    assert.deepEqual(unresolved, []);
  });

  it('leaves empty/missing values literal and reports them', () => {
    const { rendered, unresolved } = renderTemplate('Hi {{name}} <{{email}}>', {
      name: 'Duc',
      email: null
    });
    assert.equal(rendered, 'Hi Duc <{{email}}>');
    assert.deepEqual(unresolved, ['email']);
  });

  it('treats non-whitelisted tokens as unresolved (no eval/injection)', () => {
    const { rendered, unresolved } = renderTemplate('{{secret}} {{agency_name}}', {
      agency_name: 'Lumière'
    });
    assert.equal(rendered, '{{secret}} Lumière');
    assert.deepEqual(unresolved, ['secret']);
  });

  it('is case-insensitive and tolerates inner spaces in the token', () => {
    const { rendered } = renderTemplate('{{ NAME }}', { name: 'Duc' });
    assert.equal(rendered, 'Duc');
  });

  it('exposes exactly the four agreed placeholders', () => {
    assert.deepEqual([...TEMPLATE_PLACEHOLDERS], [
      'name',
      'email',
      'listing_title',
      'agency_name'
    ]);
  });
});
