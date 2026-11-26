import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';
import { HELP } from '@/lib/help';
import { screenTitle } from '@/lib/titles';
import { PageHeader } from '@/components/shell/PageHeader';
import styles from './aide.module.css';
import { msg } from '@/i18n';
import { SCREEN_LABEL, labelOf } from '@/i18n/labels';

/** « Aide — Codex » / « Help — Codex ». */
export function generateMetadata() {
  return screenTitle(msg('Help'));
}

/**
 * Help (/aide), open to every simulated role: the common tasks step by step, in the user's language (lib/HELP.ts HELP),
 * with what is simulated said where it applies. A link to the screen where a task starts only when the user has it.
 */
export default async function HelpPage() {
  const { tr, screens } = await getCtx();
  return (
    <>
    <PageHeader title={tr('Using Codex')} />
    <div className="screen" data-screen-label="Aide">
      <div className={styles.page}>
        <p className={`text-muted ${styles.lead}`}>{tr('The common tasks, step by step.')} {tr(HELP.lead)}</p>
        <nav aria-labelledby="aide-sommaire" className={styles.toc}>
          <h2 id="aide-sommaire" className={`sec-title ${styles.tocTitle}`}>{tr(HELP.contents)}</h2>
          <ol className={styles.tocList}>
            {HELP.topics.map((x) => <li key={x.id}><a href={`#${x.id}`} className="link-plain">{tr(x.title)}</a></li>)}
          </ol>
        </nav>
        {HELP.topics.map((x) => (
          <section key={x.id} id={x.id} aria-labelledby={`${x.id}-titre`} className={styles.topic}>
            <h2 id={`${x.id}-titre`} className={styles.topicTitle}>{tr(x.title)}</h2>
            <p className={styles.intro}>{tr(x.intro)}</p>
            <ol className={styles.steps}>{x.steps.map((s) => <li key={s}>{tr(s)}</li>)}</ol>
            {x.simulated && (
              <p className={styles.simulated}><span className="tag tag-outline">{tr(HELP.simulatedLabel)}</span><span>{tr(x.simulated)}</span></p>
            )}
            {x.notes && <ul className={`text-muted ${styles.notes}`}>{x.notes.map((n) => <li key={n}>{tr(n)}</li>)}</ul>}
            {x.href && screens[x.href.screen] && (
              <Link href={x.href.url} className={`btn btn-secondary ${styles.go}`}>{tr(HELP.open)} {labelOf(tr, SCREEN_LABEL, x.href.screen)}<Icon name="chevronRight" size={14} /></Link>
            )}
          </section>
        ))}
        <p className={`text-muted ${styles.foot}`}><Icon name="info" size={14} style={{ flex: 'none', marginTop: 2 }} />{tr(HELP.notesHint)}</p>
      </div>
    </div>
    </>
  );
}
