/**
 * Appearance settings: the three-way theme control.
 *
 * Three options rather than a toggle, because a two-way switch has no way back
 * to "follow my device" once it has been touched — the user would be pinned to
 * whatever they last picked, and a phone that dims at sunset would stop being
 * followed with no way to restore it.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { THEME_OPTIONS } from '@/services/theme/theme';
import { useTheme } from '@/services/theme/useTheme';

export function AppearancePanel() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          {preference === 'system'
            ? `Following your device, which is currently ${resolved}.`
            : `Always ${preference}, whatever your device is set to.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          A radiogroup rather than three buttons: it is one tab stop with arrow
          keys between options, and it announces "2 of 3" to a screen reader.
          Three buttons would be three tab stops with no stated relationship.
        */}
        <fieldset>
          <legend className="sr-only">Theme</legend>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((option) => {
              const active = preference === option.value;
              return (
                <label
                  key={option.value}
                  className={`has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-background flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground font-medium'
                      : 'border-input hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {/*
                    The radio is visually hidden rather than removed so the
                    control keeps native keyboard and screen-reader behaviour.
                    The ring is projected onto the label with has-[:focus-visible],
                    without which focus would be completely invisible.
                  */}
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={active}
                    onChange={() => setPreference(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
