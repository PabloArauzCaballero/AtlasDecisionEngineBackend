import { ApiProperty } from '@nestjs/swagger';

/** `TutorialService.present`: forma devuelta por `listProgress` y `upsertProgress`. */
export class TutorialProgressDto {
  @ApiProperty({ example: 'artifact-editor-basics' }) tutorialId!: string;
  @ApiProperty({ example: 'STARTED', enum: ['STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'] })
  status!: string;
  @ApiProperty({ example: 2 }) lastStep!: number;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty({ example: true }) autoShow!: boolean;
  @ApiProperty({ nullable: true }) completedAt!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) updatedAt!: string;
}
