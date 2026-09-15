import {it,expect,afterEach} from 'vitest';
import {areStudyPdfChartsRendered} from '../studyPdfReadiness';
afterEach(()=>{document.body.innerHTML='';});
it('ne valide pas un PDF dont le moteur de gains n’a pas produit le graphique',()=>{
 document.body.innerHTML='<div id="p8_results" style="display:none"><svg id="p8_chart"></svg></div>';
 expect(areStudyPdfChartsRendered(document)).toBe(false);
 document.querySelector<HTMLElement>('#p8_results')!.style.display='flex';
 expect(areStudyPdfChartsRendered(document)).toBe(false);
 document.querySelector('#p8_chart')!.innerHTML='<path d="M0 20L20 0"/>';
 expect(areStudyPdfChartsRendered(document)).toBe(true);
});
it('attend aussi les barres du financement lorsqu’une page financement est présente',()=>{
 document.body.innerHTML='<svg id="p11_chart"></svg>';
 expect(areStudyPdfChartsRendered(document)).toBe(false);
 document.querySelector('#p11_chart')!.innerHTML='<rect y="10" height="10"/>';
 expect(areStudyPdfChartsRendered(document)).toBe(true);
});
