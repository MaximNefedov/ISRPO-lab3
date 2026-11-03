"""Create the report from the supplied DOTX, preserving every opaque package part.

Uses Python's standard library and lxml (bundled document runtime).
Usage: python scripts/build_report.py [--repo https://github.com/owner/repo]
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile
from lxml import etree as E

ROOT = Path(__file__).resolve().parent.parent
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}


def tag(name):
    return f'{{{W}}}{name}'


def paragraph(text, heading=False, title=False):
    p = E.Element(tag('p'))
    props = E.SubElement(p, tag('pPr'))
    if title:
        E.SubElement(props, tag('pStyle'), {tag('val'): 'Title'})
    E.SubElement(props, tag('spacing'), {tag('after'): '80', tag('before'): '120' if heading else '0', tag('line'): '264', tag('lineRule'): 'auto'})
    E.SubElement(props, tag('jc'), {tag('val'): 'left' if heading or title else 'both'})
    if heading or title:
        E.SubElement(props, tag('keepNext'))
    run = E.SubElement(p, tag('r'))
    rp = E.SubElement(run, tag('rPr'))
    E.SubElement(rp, tag('rFonts'), {tag('ascii'): 'Times New Roman', tag('hAnsi'): 'Times New Roman', tag('cs'): 'Times New Roman'})
    E.SubElement(rp, tag('sz'), {tag('val'): '28' if heading or title else '24'})
    E.SubElement(rp, tag('color'), {tag('val'): '000000'})
    if heading or title:
        E.SubElement(rp, tag('b'))
    E.SubElement(run, tag('t')).text = text
    return p


def build(repo=None):
    if repo and not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?', repo):
        raise ValueError('Expected an HTTPS GitHub repository URL')
    template = ROOT / 'titlepage (1).dotx'
    with zipfile.ZipFile(template) as source:
        parts = {name: source.read(name) for name in source.namelist()}
    original = dict(parts)
    root = E.fromstring(parts['word/document.xml'])
    body = root.find('w:body', NS)
    replacements = {
        '[ТИП И НОМЕР РАБОТЫ]': 'Лабораторная работа №3',
        'M31XX': 'M3108',
        '[Имя студента]': 'Нефедов Максим Андреевич',
        '[ФИО преподавателя]': 'Кирилюк Денис Алексеевич'
    }
    found = set()
    for p in body.findall('.//w:p', NS):
        nodes = p.findall('.//w:t', NS)
        text = ''.join(n.text or '' for n in nodes)
        edited = text
        for old, new in replacements.items():
            if old in edited:
                edited = edited.replace(old, new)
                found.add(old)
        if edited != text:
            # Keep source runs, bookmarks and layout; change only text slots.
            nodes[0].text = edited
            for n in nodes[1:]:
                n.text = ''
            # The yellow fill marks editable placeholders in the template.
            for highlight in p.findall('.//w:highlight', NS):
                highlight.getparent().remove(highlight)
    assert found == set(replacements), f'Missing template slots: {set(replacements) - found}'
    section = body.find('w:sectPr', NS)
    geometry = E.tostring(section)
    # The template already ends its cover with a page break. Remove only the
    # two empty content paragraphs on its otherwise blank second page.
    while len(body) >= 2 and body[-2].tag == tag('p') and not body[-2].findall('.//w:t', NS) and not body[-2].findall('.//w:drawing', NS):
        body.remove(body[-2])
    content = [
        ('Разработка расширения Code QTE для Visual Studio Code', 'title'),
        ('Цель работы', 'heading'),
        ('Разработать расширение, которое добавляет в редактор случайные задания на реакцию, начисляет очки за успешное выполнение и учитывает время нахождения окна вне фокуса.', ''),
        ('Функциональность расширения', 'heading'),
        ('Реализованы три вида Quick Time Events: нажатие указанной клавиши, ввод последовательности из четырех клавиш и нажатие пробела при попадании движущегося маркера в выделенную зону. Задания открываются в отдельной панели рядом с кодом. Используются физические клавиши, поэтому смена раскладки не влияет на выполнение.', ''),
        ('За успех начисляется 10, 25 или 20 очков соответственно и бонус от 0 до 10 очков за скорость. Неверное нажатие, истечение времени, Esc или закрытие начатого задания сбрасывают текущий счет. Рекорд сохраняется. Доступны команды паузы, немедленного задания, просмотра и сброса статистики.', ''),
        ('Пока окно VS Code не в фокусе, задания не появляются. Начатое задание отменяется без штрафа. После возвращения назначается новый случайный интервал. Время вне фокуса накапливается и отображается в строке состояния. По умолчанию интервал составляет 45–120 секунд, время реакции — 5 секунд; значения изменяются в настройках.', ''),
        ('Реализация', 'heading'),
        ('Расширение написано на JavaScript с использованием VS Code API. Модуль game.js содержит игровую логику, extension.js отвечает за команды, фокус окна и сохранение статистики, а файлы media — за интерфейс Webview. Проверка нажатий и времени выполняется в расширении. Очки, рекорд и счетчики сохраняются в globalState; данные не отправляются по сети.', ''),
        ('Проверка и результат', 'heading'),
        ('Выполнено 17 автоматических тестов игровой логики и взаимодействия с адаптером VS Code. Проверены начисление и сброс очков, тайм-ауты, потеря фокуса, учет времени, пауза и устаревшие сообщения. Проверка синтаксиса пройдена. VSIX установлен в изолированный профиль; в VS Code 1.144.0 проверены активация, регистрация команд, открытие задания и пауза.', ''),
        ('Подготовлены установочный пакет VSIX, README с инструкциями и локальная история Git. Получено расширение для тренировки реакции во время работы в редакторе. Время закрытого редактора не учитывается; статистика ведется для текущего окна и профиля.', ''),
        ('Репозиторий', 'heading'),
        (repo or 'Ссылка на GitHub будет добавлена после публикации репозитория.', '')
    ]
    for text, role in content:
        body.insert(len(body) - 1, paragraph(text, heading=role == 'heading', title=role == 'title'))
    assert E.tostring(section) == geometry
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(
        b'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
        b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    # All other source parts (logo, footer, styles, relationships, custom XML) remain byte-for-byte.
    untouched = [name for name in original if name not in ('word/document.xml', '[Content_Types].xml')]
    assert all(parts[name] == original[name] for name in untouched)
    out = ROOT / 'docs' / 'Отчет_ЛР3_Нефедов.docx'
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dest:
        for name, data in parts.items():
            dest.writestr(name, data)
    work = ROOT / '.work'
    work.mkdir(exist_ok=True)
    inventory = {name: {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'editable': name in ('word/document.xml', '[Content_Types].xml')} for name, data in original.items()}
    (work / 'template-parts.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
    (work / 'artifact.md').write_text(
        f'# Template contract\nReference: {template}\nSHA256: {hashlib.sha256(template.read_bytes()).hexdigest()}\n'
        'Reference render: .work/template-1.png and template-2.png (Word PDF export; bundled LibreOffice unavailable).\n'
        'Two reference pages, one section; second page blank. A4 11906 x 16838 twips; margins top/bottom 1134, left 1701, right 850.\n'
        'Preserve the cover paragraph/run properties, logo, footer, 2024, discipline and variant. Replace four text slots in document.xml paragraphs containing the mapped placeholders; remove yellow highlighting only in those paragraphs.\n'
        'Keep all package parts except document.xml and the DOTX-to-DOCX content type unchanged. Full inventory in template-parts.json.\n'
        'Append report after the existing cover page break, replacing the two blank trailing body paragraphs. New body: Times New Roman 12 pt black, line spacing 1.1, 4 pt after; headings 14 pt bold with 6 pt before, keepNext. Title 14 pt uses Title paragraph role with direct font override. No new images or tables.\n'
        'Fidelity gate: unchanged section XML and untouched ZIP parts, exact four replacements, discipline/variant/year preserved, visual check of every final page.\n', encoding='utf-8')
    print(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo')
    build(parser.parse_args().repo)
