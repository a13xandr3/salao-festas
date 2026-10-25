import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Apresenta os serviços e as imagens da seção pública. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-our-services',
  templateUrl: './our-services.html',
  styleUrl: './our-services.scss',
})
export class OurServices {}
