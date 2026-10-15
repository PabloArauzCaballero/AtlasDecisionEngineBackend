import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AudioTemplateStrategy } from '@prisma/client';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Alta de una locución.
 *
 * O `templateCode` o `fixtureCode`, nunca los dos. **No hay campo de texto
 * libre**, y su ausencia es la decisión de diseño del worker, no una carencia:
 * lo que se puede decir con la voz de una organización lo fija su catálogo de
 * plantillas. Un cuadro de texto abierto convertiría cada usuario con permiso
 * en alguien capaz de poner cualquier frase en boca de la marca, y de gastar el
 * presupuesto del mes escribiendo.
 */
export class CreateAudioTtsRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @ApiPropertyOptional({
    description: 'Plantilla del catálogo a locutar. Excluyente con `fixtureCode`.',
    example: 'onboarding.welcome.named',
  })
  templateCode?: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    description:
      'Valores de las variables que declara la plantilla. El motor rechaza las que falten y las que no cumplan el formato permitido.',
    example: { name: 'Ana' },
  })
  variables?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @ApiPropertyOptional({
    description:
      'Idioma de la locución (etiqueta BCP-47). Si se omite se toma el de la plantilla y, en su defecto, el del despliegue. Forma parte de la identidad del audio: cambiarlo produce una locución distinta.',
    example: 'es-419',
  })
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({ description: 'Escenario de prueba. Excluyente con `templateCode`.' })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Sin ella se deriva de la plantilla, sus variables, el idioma y la voz vigente, de modo que repetir la misma locución no crea una segunda ejecución ni una segunda factura.',
  })
  idempotencyKey?: string;
}

/** Una plantilla de locución, tal como la ve quien va a usarla. */
export class AudioTemplateDto {
  @ApiProperty({ example: 'onboarding.welcome.named' }) code!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: AudioTemplateStrategy }) strategy!: AudioTemplateStrategy;
  @ApiProperty({ description: 'El texto, con sus variables entre llaves dobles.' })
  templateText!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) language!: string | null;
  @ApiProperty({
    type: [String],
    description: 'Variables que hay que rellenar. Se deducen del texto, no de una columna aparte.',
  })
  variables!: string[];
  @ApiProperty() isActive!: boolean;
}
