import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Apresenta os ambientes e diferenciais do espaço em cartões visuais. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-top-spaces',
  templateUrl: './top-spaces.html',
  styleUrl: './top-spaces.scss',
})
export class TopSpaces {}
