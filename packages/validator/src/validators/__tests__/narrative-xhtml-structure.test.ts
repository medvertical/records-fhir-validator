import { describe, expect, it } from 'vitest';
import { findXhtmlNestingViolations } from '../narrative-xhtml-structure';

const div = (inner: string) => `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`;

describe('XHTML element placement in narrative', () => {
  // CQF Measures' EXM108 narrative lists its criteria straight into a cell.
  it('reports list items and rows outside the containers they belong to', () => {
    expect(findXhtmlNestingViolations(div('<div><table><tr><td><li>criterion</li></td></tr></table></div>'))).toEqual([
      'Elements of type li must be in a ul|ol, not a td at div/div/table/tr/td/li',
    ]);
    expect(findXhtmlNestingViolations(div('<table><tr><td>x</td><tr><td>y</td></tr></tr></table>'))).toEqual([
      'Elements of type tr at div/table/tr cannot have the following children: tr',
      'Elements of type tr must be in a table|thead|tfoot|tbody, not a tr at div/table/tr/tr',
    ]);
  });

  it('reports blocks inside paragraphs, nested phrases and children of empty elements', () => {
    expect(findXhtmlNestingViolations(div('<p>intro<ul><li>x</li></ul></p>'))).toEqual([
      'Found block structures inside a paragraph/text element p at div/p: p/ul',
    ]);
    expect(findXhtmlNestingViolations(div('<b>bold <b>again</b></b>'))).toEqual([
      'Elements of type b at div/b cannot contain nested b at b/b',
    ]);
    expect(findXhtmlNestingViolations(div('<br>text</br>'))).toEqual(['Elements of type br cannot have children']);
  });

  it('accepts well-placed tables, lists and definition lists', () => {
    expect(findXhtmlNestingViolations(div(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td><ul><li><b>x</b></li></ul></td></tr></tbody></table>'
      + '<dl><dt>term</dt><dd>definition</dd></dl><p>text<br/><img src="#a"/></p><!-- <li>comment</li> -->'
      + '<ol>\n&#9;&#9;<li>indented with character references</li>&#x9;</ol>',
    ))).toEqual([]);
  });
});
