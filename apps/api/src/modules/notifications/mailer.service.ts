import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env';

export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

/** Sends e-mail through the SMTP server of `SMTP_URL`; without it, e-mail is simply off. */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = env.SMTP_URL ? createTransport(env.SMTP_URL) : null;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  /** Throws when the server refuses or cannot be reached; the caller records the outcome. */
  async send(mail: MailInput): Promise<void> {
    if (!this.transport) throw new Error('E-mail is not configured (SMTP_URL is empty)');
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...mail });
    this.logger.debug(`mail sent to ${mail.to}: ${mail.subject}`);
  }
}
