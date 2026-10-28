# Galeria gzip

A tabela `public.gallery_images` armazena álbum, path lógico, descrição, MIME, tamanho original e conteúdo gzip em uma coluna `bytea`. O path identifica a imagem; não representa um arquivo local ou um objeto do Storage.

Aplique `supabase/migrations/202610280001_gallery_gzip.sql` no projeto Supabase antes de usar o upload. O banco permite leitura pública e gravação somente para administradores autorizados com segundo fator. Cada lote é inserido em uma transação pela RPC `booking_gallery_upload`.

No painel, abra **Galeria**, escolha ou crie um álbum e selecione até 20 JPG/PNG/WebP, com até 5 MB por foto e 20 MB por lote. O navegador compacta os arquivos antes de enviar. A galeria pública busca o gzip no banco, descompacta e renderiza as imagens. As fotos novas não exigem commit ou nova publicação; a alteração do frontend exige publicação inicial.

Não utiliza servidor local, Edge Function, GitHub para upload ou Supabase Storage. As fotos existentes em `public/images/` não são importadas automaticamente.

Requer navegador com CompressionStream e DecompressionStream. Gzip não garante redução de tamanho de imagens já comprimidas.

Para excluir uma foto, abra o álbum no painel e clique no X sobre a imagem. A exclusão remove o registro e seu gzip do banco. Exige a migração `202610280002_gallery_delete.sql` e acesso administrativo com segundo fator.
