import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AdminAuth } from './admin-auth';
import { SiteConfig } from './site-config';
import { GalleryPhoto } from '../components/photo-viewer/photo-viewer';
import { compressPhoto, decompressPhoto } from './gallery-codec';

export interface GalleryAlbum { id: string; name: string; photos: GalleryPhoto[]; }
export interface GalleryManifest { albums: GalleryAlbum[]; }
export interface GalleryUploadResult { count: number; }
interface ImageRow {
  id: string; album_id: string; album_name: string; path: string;
  description: string; mime_type: string; original_size: number; gzip_data: string;
}

@Injectable({ providedIn: 'root' })
export class Gallery {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AdminAuth);
  private readonly settings = inject(SiteConfig);

  async load(): Promise<GalleryManifest> {
    const config = await firstValueFrom(this.settings.config$);
    const albums = new Map<string, GalleryAlbum>();
    // Páginas pequenas para não carregar todos os binários numa única resposta.
    for (let offset = 0; ; ) {
      const rows = await firstValueFrom(this.http.get<ImageRow[]>(`${config.supabaseUrl}/rest/v1/gallery_images`, {
        headers: { apikey: config.supabasePublishableKey },
        params: { select: 'id,album_id,album_name,path,description,mime_type,original_size,gzip_data', order: 'created_at.asc,id.asc', limit: 10, offset },
      }));
      if (!rows.length) break;
      for (const row of rows) {
        const album = albums.get(row.album_id) ?? { id: row.album_id, name: row.album_name, photos: [] };
        album.photos.push({ id: row.id, description: row.description, url: await decompressPhoto(row.gzip_data, row.mime_type, row.original_size) });
        albums.set(album.id, album);
      }
      offset += rows.length;
    }
    return { albums: [...albums.values()] };
  }

  async deletePhoto(id: string): Promise<void> {
    await this.auth.runAuthorized(async client => {
      const { data, error } = await client.rpc('booking_gallery_delete', { p_id: id });
      if (error || data !== true) throw new Error('Não foi possível excluir a foto. Atualize a galeria e tente novamente.');
    });
  }

  async upload(album: string, name: string, files: File[]): Promise<GalleryUploadResult> {
    if (!name.trim() || name.trim().length > 80 || !files.length || files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      throw new Error('Informe o álbum e até 20 fotos, com no máximo 20 MB no total.');
    }
    return this.auth.runAuthorized(async client => {
      const photos = [];
      for (const file of files) photos.push({ description: file.name.replace(/\.[^.]+$/, '').slice(0, 160) || name.trim(), mime_type: file.type, original_size: file.size, gzip_hex: await compressPhoto(file) });
      const { data, error } = await client.rpc('booking_gallery_upload', { p_album: album || null, p_name: name.trim(), p_photos: photos });
      if (error) throw new Error('Não foi possível salvar as fotos no Supabase. Verifique a configuração da galeria e sua sessão.');
      return { count: data as number };
    });
  }
}
