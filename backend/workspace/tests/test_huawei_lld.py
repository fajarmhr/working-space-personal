"""Synthetic fixtures: no customer LLD, addresses or credentials are committed."""
from io import BytesIO
import unittest
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from workspace.huawei_lld import generate_package, inspect_workbook
from workspace.huawei_xlsx import read_xlsx

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"


def letters(number):
    result = ""
    while number:
        number, rest = divmod(number - 1, 26)
        result = chr(65 + rest) + result
    return result


def fixture(overrides=None, extra=None):
    service = {
        3: ["Data Phase Type", "NE Name", "Network Card Type", "External Interface", "Subnet Interface", "Min. Number of Local Active Links", "Logical Network", "IP Type", "IP Version", "Start IP Address", "End IP Address", "Subnet Mask", "Gateway Address", "VLAN ID(VM)", "Logical Interfacce", "VRF", "Logical Interface IP Address"],
        4: ["New", "UPFLAB01", "NP", "200GE 1/0/1", "Eth-Trunk 1.200", "1", "lab", "External IP", "IPv4", "192.0.2.2", "-", "255.255.255.248", "192.0.2.1", "200", "SGi", "VPN_LAB", "-"],
        5: ["", "", "NP", "200GE 2/0/1", "Eth-Trunk 2.201", "1", "lab", "External IP", "IPv6", "2001:db8::2", "-", "125", "2001:db8::1", "201", "SGi", "VPN_LAB", "-"],
    }
    routing = {
        2: ["Loopback Design"],
        3: ["Data Phase Type", "DC", "VNF Name", "VRF Name", "IP Version", "Local Interface Name", "Local Interface Address", "Device Name", "VRF Name", "Local Interface Name", "Local Interface Address"],
        4: ["New", "lab", "UPFLAB01", "VPN_LAB", "IPv4", "Loopback1", "198.51.100.1", "PE1", "VPN_LAB", "Loopback9", "198.51.100.2"],
        5: ["New", "lab", "UPFLAB01", "VPN_LAB", "IPv6", "Loopback2", "2001:db8:1::1", "PE1", "VPN_LAB", "Loopback10", "2001:db8:1::2"],
        7: ["BGP Design"],
        8: ["Data Phase Type", "DC", "NE Name", "VRF Name", "Enabling the Ingress Packet Optimization", "AS Number", "Router-ID", "Local interface name", "Local interface address", "Loopback Ip Release Switch", "IP Version", "LoadBalance Policy", "import route type", "BGP Network", "BGP Network Mask", "community", "Device Name", "VRF Name", "AS Number", "Router-ID", "Local interface name", "Local interface address", "Inhibitor Switch"],
        9: ["New", "lab", "UPFLAB01", "VPN_LAB", "NA", "64512", "198.51.100.1", "Loopback1", "198.51.100.1", "OFF", "IPv4", "Y", "WLR", "NA", "NA", "-", "PE1", "VPN_LAB", "64513", "NA", "Loopback9", "198.51.100.2", "false"],
        10: ["New", "lab", "UPFLAB01", "VPN_LAB", "NA", "64512", "198.51.100.1", "Loopback2", "2001:db8:1::1", "OFF", "IPv6", "Y", "WLR", "NA", "NA", "-", "PE1", "VPN_LAB", "64513", "NA", "Loopback10", "2001:db8:1::2", "false"],
        12: ["5G Core/CloudEdge VNF -> L3GW Static Route Design"],
        13: ["Data Phase Type", "DC", "Local VNF Name", "Local VRF Name", "L3 Interface", "VLAN", "IP Version", "Route Prefix", "Subnet Mask/Mask Length", "Next Hop", "Peer VNF Name", "Peer VRF Name"],
        14: ["New", "lab", "UPFLAB01", "VPN_LAB", "200", "200", "IPv4", "0.0.0.0", "0.0.0.0", "192.0.2.1", "PE1", "VPN_LAB"],
        15: ["New", "lab", "UPFLAB01", "VPN_LAB", "Eth-Trunk 1.200", "200", "IPv4", "198.51.100.2", "255.255.255.255", "192.0.2.1", "PE1", "VPN_LAB"],
        16: ["New", "lab", "UPFLAB01", "VPN_LAB", "201", "201", "IPv6", "::", "0", "2001:db8::1", "PE1", "VPN_LAB"],
        17: ["New", "lab", "UPFLAB01", "VPN_LAB", "Eth-Trunk 2.201", "201", "IPv6", "2001:db8:1::2", "128", "2001:db8::1", "PE1", "VPN_LAB"],
        19: ["BFD Design"],
        20: ["Data Phase Type", "DC", "Local Device Name", "VRF Name", "IP Version", "Local Identification", "VLAN", "Destination IP", "Peer Device Name", "BFD Share Group", "Peer Identification", "Peer IP", "BFD Type", "BFD Enabled", "min-rx-interval(ms)", "min-tx-interval(ms)", "detect-multiplier", "Binding Routing Policy"],
        21: ["New", "lab", "UPFLAB01", "VPN_LAB", "IPv4", "1~5", "200", "-", "PE1", "-", "101~105", "192.0.2.1", "BFD", "Y", "500", "500", "4", "Static Route"],
        22: ["New", "lab", "UPFLAB01", "VPN_LAB", "IPv6", "6~10", "201", "-", "PE1", "-", "106~110", "2001:db8::1", "BFD", "Y", "500", "500", "4", "Static Route"],
    }
    for (sheet, row, col), value in (overrides or {}).items():
        target = service if sheet == 1 else routing
        while len(target.setdefault(row, [])) < col:
            target[row].append("")
        target[row][col - 1] = value
    def sheet_xml(rows, merges=""):
        content = []
        for row, values in rows.items():
            cells = [f'<c r="{letters(col)}{row}" t="inlineStr"><is><t>{escape(value)}</t></is></c>' for col, value in enumerate(values, 1)]
            content.append(f'<row r="{row}">' + "".join(cells) + '</row>')
        return f'<worksheet xmlns="{MAIN}"><sheetData>' + "".join(content) + '</sheetData>' + merges + '</worksheet>'
    result = BytesIO()
    with ZipFile(result, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets><sheet name="5G Core Service IP Design" sheetId="1" r:id="rId1"/><sheet name="Routing" sheetId="2" r:id="rId2"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{PACKAGE}"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml(service, '<mergeCells><mergeCell ref="A4:A5"/><mergeCell ref="B4:B5"/></mergeCells>'))
        archive.writestr("xl/worksheets/sheet2.xml", sheet_xml(routing))
        for name, value in (extra or {}).items():
            archive.writestr(name, value)
    return result.getvalue()


def options(data=None, **changes):
    data = data or fixture()
    names = inspect_workbook(data)["interfaces"]["UPFLAB01"]
    return {"node": "UPFLAB01", "extension": "ini", "bgp_password": "synthetic-test", "baseline_confirmed": True, "interface_names": dict.fromkeys(names) | {name: name for name in names}, **changes}


def cleanup():
    return '\n'.join(['RMV IMPORTROUTE:VRFNAME="VPN_LAB",AFTYPE=ipv4uni,IMPORTPROTOCOL=wlr;', 'RMV IMPORTROUTE:VRFNAME="VPN_LAB",AFTYPE=ipv6uni,IMPORTPROTOCOL=wlr;', 'RMV BGPVRFAF:VRFNAME="VPN_LAB",AFTYPE=ipv4uni;', 'RMV BGPVRFAF:VRFNAME="VPN_LAB",AFTYPE=ipv6uni;', 'RMV BGPVRF:VRFNAME="VPN_LAB";'])


class HuaweiLldTests(unittest.TestCase):
    def test_inspect_merged_cells_and_all_interfaces(self):
        result = inspect_workbook(fixture())
        self.assertEqual(result["nodes"], ["UPFLAB01"])
        self.assertEqual(result["node_summaries"][0]["static_routes"], 4)
        self.assertEqual(len(result["interfaces"]["UPFLAB01"]), 8)

    def test_generates_linked_lifecycle_and_correct_trunk_membership(self):
        result = generate_package(fixture(), options())
        self.assertEqual(result["summary"], {"vrfs": 1, "subinterfaces": 2, "bfd_sessions": 2, "static_routes": 4, "bgp_peers": 2, "loopbacks": 2})
        self.assertEqual(result["rollback_order"], list(reversed(result["execution_order"])))
        self.assertTrue(result["requires_review"])
        first, second = result["files"]
        self.assertEqual(set(first["sections"]), {"preparation", "execution", "verification", "rollback"})
        self.assertIn('ADD TRUNKMEMBER:TRUNKIFNAME="Eth-Trunk2",MEMBERIFNAME="200GE2/0/1";', first["sections"]["execution"])
        self.assertIn('RMV TRUNKMEMBER:TRUNKIFNAME="Eth-Trunk2",MEMBERIFNAME="200GE2/0/1";', first["sections"]["rollback"])
        self.assertEqual(second["sections"]["rollback"].count("RMV BGPPEER:"), 2)
        self.assertIn('RMV INTERFACE:IFNAME="Loopback2";', second["sections"]["rollback"])
        self.assertNotIn("SET BGP:BGPENABLE=FALSE;", second["content"])
        self.assertNotIn("SET BFD:BFDENABLE=FALSE;", first["content"])

    def test_manual_interface_mapping_is_consistent_and_collision_free(self):
        named = options()["interface_names"]
        named.update({"200GE1/0/1": "100GE9/0/1", "Eth-Trunk1": "Eth-Trunk20", "Eth-Trunk1.200": "Eth-Trunk20.200", "Loopback1": "Loopback90"})
        result = generate_package(fixture(), options(interface_names=named, physical_admin_before={"200GE1/0/1": "down"}))
        text = "\n".join(file["content"] for file in result["files"])
        self.assertIn('IFNAME="100GE9/0/1",IFADMINSTATUS=down;', text)
        self.assertIn('LOCALIFNAME="Loopback90"', text)
        self.assertIn('IFNAME="Eth-Trunk20.200"', text)
        self.assertNotIn('IFNAME="Eth-Trunk1.200"', text)
        with self.assertRaisesRegex(ValueError, "mengikuti nama trunk"):
            generate_package(fixture(), options(interface_names={**named, "Eth-Trunk1.200": "Eth-Trunk1.200"}))
        with self.assertRaisesRegex(ValueError, "duplikat"):
            generate_package(fixture(), options(interface_names={**named, "200GE2/0/1": "100GE9/0/1"}))

    def test_full_baseline_and_validated_cleanup_coverage(self):
        result = generate_package(fixture(), options(bgp_enabled_before=False, bfd_enabled_before=False, physical_admin_before={"200GE1/0/1": "down", "200GE2/0/1": "up"}, bgp_cleanup_commands=cleanup()))
        self.assertFalse(result["requires_review"])
        self.assertEqual(result["manual_steps"], [])
        self.assertIn("SET BFD:BFDENABLE=FALSE;", result["files"][0]["sections"]["rollback"])
        self.assertIn("SET BGP:BGPENABLE=FALSE;", result["files"][1]["sections"]["rollback"])
        for bad in (cleanup().splitlines()[0], cleanup().replace("VPN_LAB", "VPN_OTHER"), "\n".join(reversed(cleanup().splitlines()))):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                generate_package(fixture(), options(bgp_cleanup_commands=bad))

    def test_missing_or_unsafe_inputs_fail(self):
        for patch in ({"bgp_password": ""}, {"bgp_password": 'bad";RMV X:;'}, {"baseline_confirmed": False}, {"interface_names": {}}, {"extension": "exe"}, {"ebgp_max_hop": 0}, {"physical_admin_before": {"unknown": "down"}}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                generate_package(fixture(), options(**patch))

    def test_cross_sheet_errors_and_existing_resources_fail(self):
        cases = [
            {(1, 4, 13): "192.0.3.1"},
            {(1, 4, 14): "201"},
            {(2, 9, 9): "198.51.100.9"},
            {(2, 15, 10): "192.0.2.3"},
            {(2, 21, 6): "6~10"},
            {(2, 9, 1): "Existing"},
            {(2, 9, 3): ""},
            {(2, 9, 1): ""},
            {(2, 22, 14): "N"},
            {(2, 9, 13): "Direct"},
        ]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                inspect_workbook(fixture(changes))

    def test_shared_physical_port_cannot_belong_to_two_trunks(self):
        with self.assertRaisesRegex(ValueError, "dua trunk"):
            inspect_workbook(fixture({(1, 5, 4): "200GE 1/0/1"}))

    def test_uncached_formula_xml_entity_external_relationship_and_path_fail(self):
        with self.assertRaises(ValueError):
            read_xlsx(b"not an archive")
        with self.assertRaisesRegex(ValueError, "path"):
            read_xlsx(fixture(extra={"../bad": "bad"}))
        with self.assertRaisesRegex(ValueError, "DTD/entity"):
            read_xlsx(fixture(extra={"bad.rels": '<!DOCTYPE x [<!ENTITY y "bad">]><x/>'}))
        with self.assertRaisesRegex(ValueError, "eksternal"):
            read_xlsx(fixture(extra={"bad.rels": '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>'}))
        original = fixture()
        source = ZipFile(BytesIO(original))
        rebuilt = BytesIO()
        with ZipFile(rebuilt, "w", ZIP_DEFLATED) as target:
            for item in source.infolist():
                content = source.read(item.filename)
                if item.filename == "xl/worksheets/sheet1.xml":
                    content = content.replace(b'<c r="J4" t="inlineStr"><is><t>192.0.2.2</t></is></c>', b'<c r="J4"><f>A1</f></c>')
                target.writestr(item.filename, content)
        with self.assertRaisesRegex(ValueError, "cached value"):
            read_xlsx(rebuilt.getvalue())
