import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Apresenta a seção de celebrações do espaço. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-celebration-area',
  templateUrl: './celebration-area.html',
  styleUrl: './celebration-area.scss',
})
export class CelebrationArea {}
