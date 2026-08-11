import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { CheckboxField } from './checkbox-field';
import { EmptyState } from './empty-state';
import { Input } from './input';
import { Label } from './label';
import { Select } from './select';
import { Textarea } from './textarea';
import { controlHeight } from './control';

describe('form primitives', () => {
  /*
   * The reason these components exist. Every hand-styled control in the app
   * was `h-10` — 40px — against the 44px minimum in specs/ux-states.md. That
   * is the kind of rule that is easy to state and impossible to hold when the
   * styling lives at nine call sites.
   */
  it('meet the 44px minimum touch target', () => {
    expect(controlHeight).toBe('h-11');

    render(
      <>
        <Input aria-label="text" />
        <Select aria-label="choice">
          <option>a</option>
        </Select>
      </>,
    );

    expect(screen.getByLabelText('text').className).toContain('h-11');
    expect(screen.getByLabelText('choice').className).toContain('h-11');
  });

  it('lets a caller add classes without losing the base styling', () => {
    render(<Input aria-label="text" className="max-w-xs" />);
    const input = screen.getByLabelText('text');
    expect(input.className).toContain('max-w-xs');
    expect(input.className).toContain('border-input');
  });

  it('defaults to a text input but honours an explicit type', () => {
    render(
      <>
        <Input aria-label="plain" />
        <Input aria-label="dated" type="date" />
      </>,
    );
    expect(screen.getByLabelText('plain')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('dated')).toHaveAttribute('type', 'date');
  });

  it('gives the textarea room to grow rather than a fixed height', () => {
    render(<Textarea aria-label="notes" />);
    const textarea = screen.getByLabelText('notes');
    expect(textarea.className).toContain('min-h-24');
    expect(textarea.className).not.toContain('h-11');
  });

  it('keeps the select a real select, so phones get the native picker', () => {
    render(
      <Select aria-label="roast" defaultValue="dark">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </Select>,
    );
    const select = screen.getByLabelText('roast');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('dark');
  });

  it('associates a Label with its control', async () => {
    render(
      <>
        <Label htmlFor="roaster">Roaster</Label>
        <Input id="roaster" />
      </>,
    );
    await userEvent.type(screen.getByLabelText('Roaster'), 'Onyx');
    expect(screen.getByLabelText('Roaster')).toHaveValue('Onyx');
  });
});

describe('CheckboxField', () => {
  it('makes the whole row a 44px target', () => {
    const { container } = render(<CheckboxField label="Include archived" />);
    const label = container.querySelector('label');
    expect(label?.className).toContain('min-h-11');
  });

  it('toggles when the label text is clicked, not just the box', async () => {
    // A 16px box is under the touch minimum on its own; the label is what
    // makes it reachable.
    render(<CheckboxField label="Needs review only" />);
    await userEvent.click(screen.getByText('Needs review only'));
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('surfaces a description without breaking the label association', () => {
    render(<CheckboxField label="Sync photos" description="Uses more of your quota" />);
    expect(screen.getByRole('checkbox', { name: /sync photos/i })).toBeInTheDocument();
    expect(screen.getByText('Uses more of your quota')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('reads as a heading-and-way-out, not a dead end', () => {
    render(
      <EmptyState
        title="Your library is empty"
        description="Coffees you log land here."
        action={<button type="button">Add a coffee</button>}
      />,
    );
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a coffee' })).toBeInTheDocument();
  });

  it('hides the decorative mark from screen readers', () => {
    // The icon repeats what the title already says; announcing it is noise.
    const { container } = render(
      <EmptyState icon={<svg data-testid="mark" />} title="Nothing here" />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toContainElement(
      screen.getByTestId('mark'),
    );
  });

  it('omits the description and action when there is nothing to say', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
