import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Gallery as GalleryService, GalleryAlbum } from '../../services/gallery';
import { PhotoViewer } from '../photo-viewer/photo-viewer';

@Component({
  selector: 'app-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhotoViewer],
  template: `
    <section class="p-4 p-lg-5" aria-labelledby="gallery-title" [attr.aria-busy]="loading()">
      <h2 id="gallery-title">Galeria</h2>
      @if (loading()) { <p role="status">Carregando fotos…</p> }
      @else if (error()) { <p role="alert">{{ error() }}</p><button class="btn btn-outline-dark" (click)="load()">Tentar novamente</button> }
      @else if (selected(); as album) {
        <nav aria-label="Navegação dos álbuns" class="mb-3"><button class="btn btn-link" (click)="selected.set(null)">Álbuns</button> / {{ album.name }}</nav>
        <h3 class="h4">{{ album.name }}</h3>
        <app-photo-viewer [photos]="album.photos" />
      } @else {
        <div class="row g-3">
          @for (album of albums(); track album.id) {
            <div class="col-sm-6 col-lg-4"><button class="album btn w-100 text-start border rounded-3 p-3" (click)="selected.set(album)">
              @if (album.photos[0]; as cover) { <img [src]="cover.url" [alt]="cover.description" width="480" height="360" loading="lazy" class="w-100 rounded-2 mb-2"> }
              <span class="d-block fw-semibold">{{ album.name }}</span><span>{{ album.photos.length }} foto(s)</span>
            </button></div>
          } @empty { <p role="status">Em breve, fotos do nosso espaço.</p> }
        </div>
      }
    </section>`,
  styles: ['.album img { height: auto; aspect-ratio: 4/3; object-fit: cover; } .album:hover { background: #fff8; }'],
})
export class Gallery {
  private readonly api = inject(GalleryService);
  protected readonly albums = signal<GalleryAlbum[]>([]);
  protected readonly selected = signal<GalleryAlbum | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  constructor() { afterNextRender(() => void this.load()); }
  protected async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { this.albums.set((await this.api.load()).albums); }
    catch { this.error.set('Não foi possível carregar a galeria.'); }
    finally { this.loading.set(false); }
  }
}
