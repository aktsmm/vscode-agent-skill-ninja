// GitHub issue 作成 URL の組み立て
// 長すぎる URL は GitHub が 414 URI Too Long を返し、バグ報告そのものが開けなくなる
// https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query

/** サーバー上限は非公開なので、一般的な 8KB 制限に対して余裕を持たせる。 */
export const ISSUE_URL_MAX_LENGTH = 6000;

const TRUNCATION_NOTICE =
  "\n\n_(truncated to keep this issue URL within GitHub's length limit)_";

/**
 * 上限を超える場合は本文だけを削る。title と固定部分は縮めない。
 */
export function buildIssueUrl(
  issuesNewUrl: string,
  title: string,
  body: string,
  maxLength: number = ISSUE_URL_MAX_LENGTH,
): string {
  const compose = (issueBody: string): string => {
    const params = new URLSearchParams({ title, body: issueBody });
    return `${issuesNewUrl}?${params.toString()}`;
  };

  const full = compose(body);
  if (full.length <= maxLength) {
    return full;
  }

  let keep = 0;
  let upperBound = body.length;
  while (keep < upperBound) {
    const midpoint = Math.ceil((keep + upperBound) / 2);
    if (
      compose(body.slice(0, midpoint) + TRUNCATION_NOTICE).length <= maxLength
    ) {
      keep = midpoint;
    } else {
      upperBound = midpoint - 1;
    }
  }

  return compose(body.slice(0, keep) + TRUNCATION_NOTICE);
}
