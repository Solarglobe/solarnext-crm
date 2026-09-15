/** A loaded view model alone is insufficient: legacy chart scripts can fail to load. */
export function areStudyPdfChartsRendered(root: ParentNode): boolean {
 const gains=root.querySelector<HTMLElement>('#p8_results');
 if(gains&&(gains.style.display==='none'||!root.querySelector('#p8_chart path')))return false;
 const financing=root.querySelector('#p11_chart');
 if(financing&&!financing.querySelector('rect'))return false;
 return true;
}
