import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-presentation',
  templateUrl: './presentation.html',
  styleUrl: './presentation.scss',
})
export class Presentation {}
