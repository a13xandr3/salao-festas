import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Apresenta a chamada inicial do site e os acessos aos espaços e à agenda. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-presentation',
  templateUrl: './presentation.html',
  styleUrl: './presentation.scss',
})
export class Presentation {}
