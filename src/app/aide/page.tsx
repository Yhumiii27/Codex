import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';
import { HELP } from '@/lib/i18n';
import { screenTitle } from '@/lib/titles';
import styles from './aide.module.css';

/** « Aide — Codex » / « Help — Codex ». */
export function generateMetadata() {
  return screenTitle('sc_help');
}

/**
 * Help (/aide), open to every simulated role: the common tasks step by step, in the user's language (lib/i18n.ts HELP),
 * with what is simulated said where it applies. A link to the screen where a task starts only when the user has it.
 */
export default async function HelpPage() {
  const { t, lang, screens } = await getCtx();
  const help = HELP[lang];
  return (
    <div className="screen" style={{ overflow: 'auto', padding: 'var(--space-8)' }} data-screen-label="Aide">
      <div className={styles.page}>
        <h2 className={styles.title}>{t.help_title}</h2>
        <p className={`text-muted ${styles.lead}`}>{t.help_sub} {help.lead}</p>
        <nav aria-labelledby="aide-sommaire" className={styles.toc}>
          <h3 id="aide-sommaire" className={`sec-title ${styles.tocTitle}`}>{help.contents}</h3>
          <ol className={styles.tocList}>
            {help.topics.map((x) => <li key={x.id}><a href={`#${x.id}`} className="link-plain">{x.title}</a></li>)}
          </ol>
        </nav>
        {help.topics.map((x) => (
          <section key={x.id} id={x.id} aria-labelledby={`${x.id}-titre`} className={styles.topic}>
            <h3 id={`${x.id}-titre`} className={styles.topicTitle}>{x.title}</h3>
            <p className={styles.intro}>{x.intro}</p>
            <ol className={styles.steps}>{x.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            {x.simulated && (
              <p className={styles.simulated}><span className="tag tag-outline">{help.simulatedLabel}</span><span>{x.simulated}</span></p>
            )}
            {x.notes && <ul className={`text-muted ${styles.notes}`}>{x.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {x.href && screens[x.href.screen] && (
              <Link href={x.href.url} className={`btn btn-secondary ${styles.go}`}>{help.open} {t[`nav_${x.href.screen}`]}<Icon name="chevronRight" size={14} /></Link>
            )}
          </section>
        ))}
        <p className={`text-muted ${styles.foot}`}><Icon name="info" size={14} style={{ flex: 'none', marginTop: 2 }} />{help.notesHint}</p>
      </div>
    </div>
  );
}
