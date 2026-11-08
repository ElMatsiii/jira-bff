import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const logger = new Logger('JiraBFFBootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const configService = app.get(ConfigService);
  const port = configService.port;

  await app.listen(port);
  logger.log(`Jira AI BFF Gateway is running on: http://localhost:${port}/graphql`);
}

bootstrap().catch((err) => {
  console.error('Failed to start Jira BFF Gateway:', err);
  process.exit(1);
});
