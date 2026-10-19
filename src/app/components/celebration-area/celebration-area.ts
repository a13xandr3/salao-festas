import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-celebration-area',
  templateUrl: './celebration-area.html',
  styleUrl: './celebration-area.scss',
})
export class CelebrationArea {}
