'use client';
import { useState } from 'react';
import { itemPhotoLimits, type ItemPhoto } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Checkbox } from '@havefolio/ui/components/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import { Label } from '@havefolio/ui/components/label';
import { Textarea } from '@havefolio/ui/components/textarea';

const max = itemPhotoLimits.maxAltTextLength;

/** Returns a validation message, or undefined when the description can be saved. */
export function validateAltText(text: string, decorative: boolean): string | undefined {
  const value = text.trim();
  if (decorative) return undefined;
  if ([...value].length > max) return `Use ${max} characters or fewer.`;
  if (/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g, ' ')))
    return 'Remove hidden or control characters.';
  if (/\n/.test(value)) return 'Use a single line.';
  if (
    /^[\w-]+\.(jpe?g|png|webp|heic|heif|gif)$/i.test(value) ||
    /^(IMG|DSC|PXL)[_-]?\d+/i.test(value)
  )
    return 'This looks like a file name. Describe what the photo shows instead.';
  return undefined;
}

export function PhotoDescriptionDialog({
  onCloseAutoFocus,
  position,
  onOpenChange,
  onSave,
  open,
  photo,
}: {
  position: number;
  open: boolean;
  onCloseAutoFocus: (event: Event) => void;
  photo: ItemPhoto | undefined;
  onOpenChange: (open: boolean) => void;
  /** Resolves to an error message to keep the dialog open, or undefined on success. */
  onSave: (altText: string | null, decorative: boolean) => Promise<string | undefined>;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        {photo ? (
          // Keyed so a different photo always starts from its persisted description.
          <DescriptionForm key={photo.id} position={position} photo={photo} onSave={onSave} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DescriptionForm({
  onSave,
  photo,
  position,
}: {
  position: number;
  photo: ItemPhoto;
  onSave: (altText: string | null, decorative: boolean) => Promise<string | undefined>;
}): React.JSX.Element {
  const [text, setText] = useState(photo.altText ?? '');
  const [decorative, setDecorative] = useState(photo.decorative);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const length = [...text.trim()].length;
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const problem = validateAltText(text, decorative);
    setError(problem);
    if (problem) return;
    setSaving(true);
    const failure = await onSave(decorative ? null : text.trim() || null, decorative);
    setSaving(false);
    if (failure) setError(failure);
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>Describe photo {position}</DialogTitle>
        <DialogDescription>
          A short description helps screen-reader users and you find this photo later. Say what it
          shows, such as “Front of the kettle with the lid open”. File names are not used.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="photo-alt-text">Description</Label>
        <Textarea
          id="photo-alt-text"
          value={text}
          disabled={decorative || saving}
          maxLength={max * 2}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby="photo-alt-text-count photo-alt-text-error"
          onChange={(e) => setText(e.target.value)}
        />
        <p id="photo-alt-text-count" className="text-sm text-muted-foreground">
          {length} of {max} characters. Leave empty to describe later.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="photo-decorative"
          className="mt-0.5"
          checked={decorative}
          disabled={saving}
          onCheckedChange={(value) => {
            setDecorative(value === true);
            setError(undefined);
          }}
        />
        <div className="space-y-1">
          <Label htmlFor="photo-decorative">Decorative photo</Label>
          <p className="text-sm text-muted-foreground">
            Only when the photo adds nothing beyond the item name shown beside it. Screen readers
            will skip it.
          </p>
        </div>
      </div>
      <p id="photo-alt-text-error" role="alert" className="text-sm text-destructive">
        {error}
      </p>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="min-h-11" disabled={saving}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="min-h-11" disabled={saving}>
          {saving ? 'Saving…' : 'Save description'}
        </Button>
      </DialogFooter>
    </form>
  );
}
