import { afterNextRender, ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Gallery, GalleryAlbum } from '../../services/gallery';
import { PhotoViewer } from '../photo-viewer/photo-viewer';

@Component({
  selector: 'app-gallery-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PhotoViewer],
  templateUrl: './gallery-admin.html',
})
export class GalleryAdmin {
  private readonly api = inject(Gallery);
  readonly disabled = input(false);
  readonly writing = output<boolean>();
  protected readonly albums = signal<GalleryAlbum[]>([]);
  protected readonly selected = signal<GalleryAlbum | null>(null);
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);
  protected readonly files = signal<File[]>([]);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = new FormGroup({ name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }) });
  constructor() { afterNextRender(() => void this.load()); }
  protected async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { this.albums.set((await this.api.load()).albums); }
    catch { this.error.set('Não foi possível carregar os álbuns.'); }
    finally { this.loading.set(false); }
  }
  protected open(album: GalleryAlbum | null): void {
    if (this.uploading() || this.disabled()) return;
    this.selected.set(album); this.files.set([]); this.error.set('');
    this.form.controls.name.setValue(album?.name ?? '');
  }
  protected choose(event: Event): void {
    if (this.uploading() || this.disabled()) return;
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.error.set(''); this.files.set([]);
    if (files.length > 20 || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      this.error.set('Selecione até 20 fotos JPG, PNG ou WebP, com até 5 MB por foto e 20 MB por envio.'); input.value = ''; return;
    }
    this.files.set(files);
  }
  protected async deletePhoto(id: string): Promise<void> {
    if (this.disabled() || this.uploading() || this.loading()) return;
    this.uploading.set(true); this.writing.emit(true); this.error.set(''); this.notice.set('');
    try {
      await this.api.deletePhoto(id);
      const albums = this.albums().map(album => ({ ...album, photos: album.photos.filter(photo => photo.id !== id) })).filter(album => album.photos.length);
      const selectedId = this.selected()?.id;
      this.albums.set(albums);
      this.selected.set(albums.find(album => album.id === selectedId) ?? null);
      if (!this.selected()) this.form.controls.name.setValue('');
      this.notice.set('Foto excluída da galeria.');
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Não foi possível excluir a foto.');
    } finally { this.uploading.set(false); this.writing.emit(false); }
  }

  protected async submit(input: HTMLInputElement): Promise<void> {
    if (this.disabled() || this.uploading() || this.loading() || this.form.invalid || !this.form.controls.name.value.trim() || !this.files().length) return;
    this.uploading.set(true); this.writing.emit(true); this.error.set(''); this.notice.set('');
    try {
      const album = this.selected();
      const result = await this.api.upload(album?.id ?? '', album?.name ?? this.form.controls.name.value, this.files());
      this.files.set([]); input.value = '';
      this.notice.set(`${result.count} foto(s) salva(s) em gzip no Supabase.`);
      await this.load();
      this.selected.set(this.albums().find(item => album ? item.id === album.id : item.name === this.form.controls.name.value.trim()) ?? null);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Não foi possível salvar as fotos.');
    }
    finally { this.uploading.set(false); this.writing.emit(false); }
  }
}
