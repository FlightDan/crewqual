from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace


MODULE_PATH = Path(__file__).with_name("convert_pilot_mock.py")
SPEC = importlib.util.spec_from_file_location("pilot_mock_converter", MODULE_PATH)
assert SPEC and SPEC.loader
converter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = converter
SPEC.loader.exec_module(converter)


class ConverterCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = bytes.fromhex("11" * 32)

    def source(self, row_number: int, name: str) -> object:
        return converter.SourceRow(row_number, name, {}, {})

    def person(self, row_number: int, name: str, phone: str) -> object:
        person_key = f"{name}\x1f{phone}"
        return converter.PersonRow(
            row_number,
            person_key,
            converter.person_token(self.key, person_key),
            name,
            phone,
            self.source(row_number, name),
        )

    def test_headers_match_current_template_contract(self) -> None:
        self.assertEqual(len(converter.EXPECTED_HEADERS), 31)
        self.assertEqual(converter.EXPECTED_HEADERS[:7], [
            "employeeNumber",
            "displayName",
            "mobile",
            "aircraftType",
            "roleCode",
            "unitCode",
            "rankCode",
        ])

    def test_normalization_and_phone_parsing(self) -> None:
        self.assertEqual(converter.normalize_name(" 张　三 "), "张三")
        self.assertEqual(converter.normalize_phone("+86 138-0013-8000"), "13800138000")
        self.assertIsNone(converter.normalize_phone("13800138000 / 13900139000"))

    def test_hmac_tokens_are_stable_and_keyed(self) -> None:
        person_key = "张三\x1f13800138000"
        token = converter.person_token(self.key, person_key)
        self.assertRegex(token, r"^[A-Z2-7]{16}$")
        self.assertEqual(token, converter.person_token(self.key, person_key))
        self.assertNotEqual(token, converter.person_token(bytes.fromhex("22" * 32), person_key))

    def test_mock_mobiles_are_unique_and_stable(self) -> None:
        people = [
            self.person(3, "张三", "13800138000"),
            self.person(4, "李四", "13900139000"),
        ]
        first = converter.assign_mock_mobiles(self.key, people)
        second = converter.assign_mock_mobiles(self.key, list(reversed(people)))
        self.assertEqual(first, second)
        self.assertEqual(len(set(first.values())), 2)
        self.assertTrue(all(value.startswith("100") and len(value) == 11 for value in first.values()))

    def test_month_arithmetic_clamps_month_end(self) -> None:
        self.assertEqual(converter.add_months(date(2024, 8, 31), 6), date(2025, 2, 28))
        self.assertEqual(converter.add_months(date(2024, 2, 29), 12), date(2025, 2, 28))
        self.assertEqual(converter.add_months(date(2027, 2, 28), -36), date(2024, 2, 28))

    def test_date_parser_is_strict(self) -> None:
        self.assertEqual(converter.parse_date_value("2026年8月9日"), date(2026, 8, 9))
        self.assertEqual(converter.parse_date_value("2026/08/09"), date(2026, 8, 9))
        self.assertIsNone(converter.parse_date_value("08/09"))
        self.assertIsNone(converter.parse_date_value("=TODAY()"))

    def test_blue_font_or_fill_selects_six_month_cycle(self) -> None:
        blue = SimpleNamespace(type="rgb", rgb="FF4472C4", tint=0.0)
        empty_fill = SimpleNamespace(fill_type=None, fgColor=None)
        blue_font_cell = SimpleNamespace(
            fill=empty_fill,
            font=SimpleNamespace(color=blue),
        )
        blue_fill_cell = SimpleNamespace(
            fill=SimpleNamespace(fill_type="solid", fgColor=blue),
            font=SimpleNamespace(color=None),
        )
        plain_cell = SimpleNamespace(fill=empty_fill, font=SimpleNamespace(color=None))
        workbook = SimpleNamespace(loaded_theme=None)
        self.assertEqual(converter.medical_cycle_months(blue_font_cell, workbook), 6)
        self.assertEqual(converter.medical_cycle_months(blue_fill_cell, workbook), 6)
        self.assertEqual(converter.medical_cycle_months(plain_cell, workbook), 12)

    def test_csv_render_and_validation(self) -> None:
        people = [
            self.person(3, "张三", "13800138000"),
            self.person(4, "李四", "13900139000"),
        ]
        mobiles = converter.assign_mock_mobiles(self.key, people)
        rows = []
        for person in people:
            row = {header: "" for header in converter.EXPECTED_HEADERS}
            row.update({
                "employeeNumber": f"MOCK-{person.token}",
                "displayName": f"飞行员-{person.token}",
                "mobile": mobiles[person.token],
            })
            rows.append(row)
        converter.validate_output(converter.EXPECTED_HEADERS, rows, people, self.key)
        payload = converter.render_csv(converter.EXPECTED_HEADERS, rows)
        self.assertTrue(payload.startswith(b"\xef\xbb\xbf"))
        self.assertIn(b"\r\n", payload)
        self.assertNotIn("张三".encode(), payload)
        self.assertNotIn(b"13800138000", payload)

    def test_template_validation_rejects_column_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "template.csv"
            path.write_text(",".join(converter.EXPECTED_HEADERS) + "\n", encoding="utf-8")
            self.assertEqual(
                converter.read_and_validate_template(path),
                converter.EXPECTED_HEADERS,
            )
            path.write_text("wrong,header\n", encoding="utf-8")
            with self.assertRaises(converter.ConversionError):
                converter.read_and_validate_template(path)


if __name__ == "__main__":
    unittest.main()
