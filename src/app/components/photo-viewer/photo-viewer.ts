import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

export interface GalleryPhoto {
  id: string;
  url: string;
  description: string;
}

/** Grade responsiva e ampliação modal, com navegação por teclado. */
@Component({
  selector: 'app-photo-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-viewer.html',
  styleUrl: './photo-viewer.scss',
})
export class PhotoViewer {
  readonly removable = input(false);
  readonly disabled = input(false);
  readonly remove = output<GalleryPhoto>();
  readonly photos = input.required<readonly GalleryPhoto[]>();
  protected readonly selected = signal<number | null>(null);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');
  private opener: HTMLButtonElement | null = null;

  protected open(index: number, button: HTMLButtonElement): void {
    if (!this.photos()[index]) return;
    this.opener = button;
    this.selected.set(index);
    this.dialog().nativeElement.showModal();
  }

  protected move(direction: number): void {
    const index = this.selected();
    const length = this.photos().length;
    if (index !== null && length) this.selected.set((index + direction + length) % length);
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected closed(): void {
    this.selected.set(null);
    this.opener?.focus();
    this.opener = null;
  }
}
