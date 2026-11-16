"""Deterministic Huawei MML generation from the two-sheet NP/BGP/BFD LLD.

No workbook code, supplied template code, shell or device connections are executed.
"""
from dataclasses import dataclass
from hashlib import sha256
from ipaddress import ip_address, ip_interface, ip_network
import re

from workspace.huawei_xlsx import Sheet, read_xlsx

TEMPLATE_VERSION = "huawei-np-bgp-bfd-v1"
SERVICE_SHEET = "5G Core Service IP Design"
ROUTING_SHEET = "Routing"


def normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).casefold()


def token(text: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,100}", text):
        raise ValueError(f"{label}: nama/identifier tidak valid.")
    return text


def number(text, label, minimum=1, maximum=4_294_967_295):
    if isinstance(text, bool) or not re.fullmatch(r"[0-9]+", str(text)):
        raise ValueError(f"{label}: harus bilangan bulat.")
    value = int(text)
    if not minimum <= value <= maximum:
        raise ValueError(f"{label}: harus {minimum}–{maximum}.")
    return value


def address(text: str, version: int, label: str) -> str:
    try:
        value = ip_address(text)
        if value.version != version:
            raise ValueError()
    except ValueError as exc:
        raise ValueError(f"{label}: alamat IPv{version} tidak valid.") from exc
    return text


def version(text: str, label: str) -> int:
    if text.lower() not in ("ipv4", "ipv6"):
        raise ValueError(f"{label}: IP Version harus IPv4 atau IPv6.")
    return int(text[-1])


def mask(text: str, family: int, label: str) -> int:
    try:
        if family == 4 and "." in text:
            return ip_network(f"0.0.0.0/{text}").prefixlen
        return number(text, label, 0, 32 if family == 4 else 128)
    except ValueError as exc:
        raise ValueError(f"{label}: mask tidak valid.") from exc


@dataclass
class Table:
    sheet: Sheet
    header: int
    columns: dict[str, list[int]]
    records: list[int]

    def get(self, row, name, occurrence=0):
        choices = self.columns.get(normalized(name), [])
        if len(choices) <= occurrence:
            raise ValueError(f"{self.sheet.name}: kolom '{name}' tidak ditemukan.")
        return self.sheet.value(row, choices[occurrence])

    def source(self, row):
        return f"{self.sheet.name}!baris {row}"


def table(sheet: Sheet, signature: set[str]) -> Table:
    wanted = {normalized(item) for item in signature}
    sheet_rows = list(sheet.rows())
    for row, values in sheet_rows:
        columns = {}
        for column, value in values.items():
            columns.setdefault(normalized(value), []).append(column)
        if wanted <= columns.keys():
            phase = columns.get("data phase type")
            if not phase:
                continue
            records = []
            for current, current_values in sheet_rows:
                if current <= row:
                    continue
                present = {value.strip() for value in current_values.values() if value.strip()}
                if not present:
                    continue
                phase_value = sheet.value(current, phase[0])
                if normalized(phase_value).startswith(("note:", "notes:")) or normalized(phase_value) == "data phase type":
                    break
                # Section captions are merged across most columns. Data rows have
                # several distinct parameters; a blank phase there is an error.
                if phase_value and len(present) <= 2 and normalized(phase_value) not in {"new", "existing", "modify", "delete", "update"}:
                    break
                if not phase_value:
                    raise ValueError(f"{sheet.name}!baris {current}: Data Phase Type kosong di dalam tabel.")
                records.append(current)
            if not records:
                raise ValueError(f"{sheet.name}!baris {row}: tabel kosong.")
            return Table(sheet, row, columns, records)
    raise ValueError(f"{sheet.name}: tabel dengan kolom {', '.join(sorted(signature))} tidak ditemukan.")


def workbook_tables(data):
    sheets = read_xlsx(data)
    lookup = {sheet.name: sheet for sheet in sheets}
    for name in (SERVICE_SHEET, ROUTING_SHEET):
        if name not in lookup:
            raise ValueError(f"Sheet '{name}' diperlukan.")
    service, routing = lookup[SERVICE_SHEET], lookup[ROUTING_SHEET]
    tables = {
        "np": table(service, {"NE Name", "External Interface", "Subnet Interface", "Start IP Address"}),
        "loopback": table(routing, {"VNF Name", "Local Interface Name", "Local Interface Address"}),
        "bgp": table(routing, {"NE Name", "AS Number", "Local interface address", "LoadBalance Policy"}),
        "route": table(routing, {"Local VNF Name", "L3 Interface", "Next Hop", "Route Prefix"}),
        "bfd": table(routing, {"Local Identification", "Peer Identification", "min-rx-interval(ms)"}),
    }
    for name, column in (("np", "NE Name"), ("loopback", "VNF Name"), ("bgp", "NE Name"), ("route", "Local VNF Name"), ("bfd", "Local Device Name")):
        for row in tables[name].records:
            if not tables[name].get(row, column):
                raise ValueError(f"{tables[name].source(row)}: {column} kosong; gunakan merged cell yang benar.")
    return sheets, tables


def new_resource(t, row):
    if normalized(t.get(row, "Data Phase Type")) != "new":
        raise ValueError(f"{t.source(row)}: hanya Data Phase Type=New didukung; perubahan existing memerlukan baseline tersendiri.")


def matching(t, node, column):
    return [row for row in t.records if t.get(row, column) == node]


def unique(items, key, label):
    found = {}
    for item in items:
        identifier = key(item)
        if identifier in found and found[identifier] != item:
            raise ValueError(f"{label}: key duplikat/konflik {identifier}.")
        found[identifier] = item
    return list(found.values())


def model(tables, node):
    token(node, "Node")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", node):
        raise ValueError("Nama node harus aman untuk nama file: huruf/angka, titik, garis bawah, atau minus.")
    np = tables["np"]
    links, trunks, physical = [], {}, {}
    for row in matching(np, node, "NE Name"):
        new_resource(np, row)
        src = np.source(row)
        iface = re.sub(r"\s+", "", np.get(row, "Subnet Interface"))
        match = re.fullmatch(r"Eth-Trunk([0-9]+)\.([0-9]+)", iface, re.I)
        if not match:
            raise ValueError(f"{src}: Subnet Interface harus Eth-TrunkN.VLAN.")
        trunk = f"Eth-Trunk{int(match[1])}"
        iface = f"{trunk}.{int(match[2])}"
        vlan = number(np.get(row, "VLAN ID(VM)"), src + " VLAN", 1, 4094)
        if vlan != int(match[2]):
            raise ValueError(f"{src}: VLAN berbeda dari nomor subinterface.")
        ports = tuple(re.sub(r"\s+", "", port) for port in np.get(row, "External Interface").split(","))
        if not ports or len(set(ports)) != len(ports):
            raise ValueError(f"{src}: anggota trunk kosong/duplikat.")
        for port in ports:
            if not re.fullmatch(r"[A-Za-z0-9-]+[0-9]+/[0-9]+/[0-9]+", port):
                raise ValueError(f"{src}: format physical interface tidak valid.")
            if port in physical and physical[port] != trunk:
                raise ValueError(f"{src}: port {port} dipakai oleh dua trunk.")
            physical[port] = trunk
        least = number(np.get(row, "Min. Number of Local Active Links"), src + " minimum active links", 1, len(ports))
        config = {"ports": ports, "least": least}
        if trunk in trunks and trunks[trunk] != config:
            raise ValueError(f"{src}: anggota/minimum link {trunk} tidak konsisten.")
        trunks[trunk] = config
        family = version(np.get(row, "IP Version"), src)
        local = address(np.get(row, "Start IP Address"), family, src)
        gateway = address(np.get(row, "Gateway Address"), family, src)
        length = mask(np.get(row, "Subnet Mask"), family, src)
        network = ip_interface(f"{local}/{length}").network
        if ip_address(gateway) not in network or ip_address(gateway) == ip_address(local):
            raise ValueError(f"{src}: gateway harus berbeda dan berada dalam subnet yang sama.")
        if family == 4 and length < 31 and (ip_address(local) in (network.network_address, network.broadcast_address) or ip_address(gateway) in (network.network_address, network.broadcast_address)):
            raise ValueError(f"{src}: IP/gateway memakai alamat network atau broadcast.")
        vrf = token(np.get(row, "VRF"), src + " VRF")
        links.append({"interface": iface, "trunk": trunk, "vlan": vlan, "family": family, "local": local, "gateway": gateway, "length": length, "vrf": vrf})
    if not links:
        raise ValueError(f"Node '{node}' tidak memiliki koneksi NP.")
    links = unique(links, lambda item: (item["interface"], item["family"]), "NP")
    for iface in {link["interface"] for link in links}:
        if len({link["vrf"] for link in links if link["interface"] == iface}) != 1:
            raise ValueError(f"{iface}: subinterface terikat ke dua VRF.")
    loopbacks, peers, routes, sessions, warnings = [], [], [], [], []
    lp = tables["loopback"]
    for row in matching(lp, node, "VNF Name"):
        new_resource(lp, row)
        src = lp.source(row)
        family = version(lp.get(row, "IP Version"), src)
        iface = re.sub(r"\s+", "", lp.get(row, "Local Interface Name"))
        if not re.fullmatch(r"Loopback[0-9]+", iface, re.I):
            raise ValueError(f"{src}: nama Loopback tidak valid.")
        iface = "Loopback" + str(int(re.search(r"[0-9]+", iface)[0]))
        loopbacks.append({"interface": iface, "local": address(lp.get(row, "Local Interface Address"), family, src), "family": family, "vrf": token(lp.get(row, "VRF Name"), src)})
    loopbacks = unique(loopbacks, lambda item: item["interface"], "Loopback")
    bgp = tables["bgp"]
    for row in matching(bgp, node, "NE Name"):
        new_resource(bgp, row)
        src = bgp.source(row)
        family = version(bgp.get(row, "IP Version"), src)
        iface = re.sub(r"\s+", "", bgp.get(row, "Local interface name"))
        iface = "Loopback" + str(int(re.search(r"[0-9]+", iface)[0])) if re.fullmatch(r"Loopback[0-9]+", iface, re.I) else token(iface, src)
        local = address(bgp.get(row, "Local interface address"), family, src)
        vrf = token(bgp.get(row, "VRF Name"), src)
        if not any(item["interface"] == iface and item["vrf"] == vrf and ip_address(item["local"]) == ip_address(local) for item in loopbacks):
            raise ValueError(f"{src}: local BGP interface/address tidak cocok dengan Loopback Design.")
        if bgp.get(row, "VRF Name", 1) != vrf:
            raise ValueError(f"{src}: peer VRF berbeda; inter-VRF BGP tidak didukung template ini.")
        if normalized(bgp.get(row, "import route type")) != "wlr":
            raise ValueError(f"{src}: hanya import route type WLR didukung template ini.")
        loadbalance = bgp.get(row, "LoadBalance Policy").upper()
        if loadbalance not in ("Y", "N"):
            raise ValueError(f"{src}: LoadBalance Policy harus Y atau N.")
        peers.append({"vrf": vrf, "family": family, "interface": iface, "local": local,
                      "peer": address(bgp.get(row, "Local interface address", 1), family, src),
                      "asn": number(bgp.get(row, "AS Number"), src + " local AS"),
                      "remote_as": number(bgp.get(row, "AS Number", 1), src + " remote AS"),
                      "router_id": address(bgp.get(row, "Router-ID"), 4, src + " router ID"),
                      "loadbalance": loadbalance == "Y"})
    peers = unique(peers, lambda item: (item["vrf"], item["family"], ip_address(item["peer"])), "BGP peer")
    if not peers or not loopbacks:
        raise ValueError("Node memerlukan Loopback Design dan BGP Design.")
    if len({peer["asn"] for peer in peers}) != 1:
        raise ValueError("AS lokal BGP tidak konsisten.")
    np_pairs = {(link["vrf"], link["family"]) for link in links}
    if any((item["vrf"], item["family"]) not in np_pairs for item in peers + loopbacks):
        raise ValueError("BGP/Loopback VRF dan IP family harus memiliki pasangan NP yang dibuat paket ini.")
    for pair in np_pairs:
        if len({peer["loadbalance"] for peer in peers if (peer["vrf"], peer["family"]) == pair}) > 1:
            raise ValueError(f"{pair[0]} IPv{pair[1]}: LoadBalance Policy tidak konsisten.")
    for vrf in {peer["vrf"] for peer in peers}:
        if len({peer["router_id"] for peer in peers if peer["vrf"] == vrf}) != 1:
            raise ValueError(f"{vrf}: router ID BGP tidak konsisten.")
    rt = tables["route"]
    for row in matching(rt, node, "Local VNF Name"):
        new_resource(rt, row)
        src = rt.source(row)
        family = version(rt.get(row, "IP Version"), src)
        vrf = token(rt.get(row, "Local VRF Name"), src)
        vlan = number(rt.get(row, "VLAN"), src + " VLAN", 1, 4094)
        gateway = address(rt.get(row, "Next Hop"), family, src)
        candidates = [link for link in links if link["vrf"] == vrf and link["family"] == family and link["vlan"] == vlan and ip_address(link["gateway"]) == ip_address(gateway)]
        if len(candidates) != 1:
            raise ValueError(f"{src}: route tidak memiliki satu pasangan VLAN/VRF/gateway di NP design.")
        interface = re.sub(r"\s+", "", rt.get(row, "L3 Interface"))
        if interface != str(vlan) and interface.casefold() != candidates[0]["interface"].casefold():
            raise ValueError(f"{src}: L3 interface berbeda dari koneksi NP.")
        prefix = address(rt.get(row, "Route Prefix"), family, src)
        length = mask(rt.get(row, "Subnet Mask/Mask Length"), family, src)
        if ip_network(f"{prefix}/{length}", strict=False).network_address != ip_address(prefix):
            raise ValueError(f"{src}: Route Prefix bukan alamat network untuk mask tersebut.")
        destination = token(rt.get(row, "Peer VRF Name"), src)
        if destination != vrf:
            raise ValueError(f"{src}: route antar-VRF tidak didukung template ini.")
        routes.append({"vrf": vrf, "family": family, "vlan": vlan, "gateway": gateway, "interface": candidates[0]["interface"], "prefix": prefix, "length": length})
    routes = unique(routes, lambda item: (item["vrf"], item["family"], item["prefix"], item["length"], item["interface"], item["gateway"]), "Static route")
    bfd = tables["bfd"]
    bfd_by_key = {}
    for row in matching(bfd, node, "Local Device Name"):
        new_resource(bfd, row)
        src = bfd.source(row)
        if bfd.get(row, "BFD Enabled").upper() != "Y":
            raise ValueError(f"{src}: template ini memerlukan BFD Enabled=Y.")
        family = version(bfd.get(row, "IP Version"), src)
        vrf = token(bfd.get(row, "VRF Name"), src)
        vlan = number(bfd.get(row, "VLAN"), src + " VLAN", 1, 4094)
        gateway = address(bfd.get(row, "Peer IP"), family, src)
        key = vrf, family, vlan, ip_address(gateway)
        matches = [link for link in links if (link["vrf"], link["family"], link["vlan"], ip_address(link["gateway"])) == key]
        if len(matches) != 1:
            raise ValueError(f"{src}: BFD tidak cocok dengan NP design.")
        ident = bfd.get(row, "Local Identification")
        match = re.fullmatch(r"([0-9]+)(?:\s*[~–-]\s*([0-9]+))?", ident)
        if not match:
            raise ValueError(f"{src}: Local Identification BFD tidak valid.")
        local_id = number(match[1], src + " local discriminator")
        if match[2] and number(match[2], src) < local_id:
            raise ValueError(f"{src}: range Local Identification terbalik.")
        rx = number(bfd.get(row, "min-rx-interval(ms)"), src + " BFD interval", 1, 60_000)
        tx = number(bfd.get(row, "min-tx-interval(ms)"), src + " BFD interval", 1, 60_000)
        if rx != tx:
            raise ValueError(f"{src}: RX/TX interval berbeda; template one-arm echo hanya mendukung interval yang sama.")
        multi = number(bfd.get(row, "detect-multiplier"), src + " BFD multiplier", 1, 255)
        if key in bfd_by_key:
            prior = bfd_by_key[key]
            if (prior["rx"], prior["tx"], prior["multi"]) != (rx, tx, multi):
                raise ValueError(f"{src}: parameter BFD dengan gateway sama tidak konsisten.")
            continue
        bfd_by_key[key] = {**matches[0], "id": local_id, "rx": rx, "tx": tx, "multi": multi}
    for link in links:
        key = link["vrf"], link["family"], link["vlan"], ip_address(link["gateway"])
        if key not in bfd_by_key:
            raise ValueError(f"{link['interface']}: BFD Design tidak ditemukan.")
    counters = {}
    for session in bfd_by_key.values():
        vrf = session["vrf"]
        counters[vrf] = counters.get(vrf, 0) + 1
        session["name"] = f"BFD_{vrf}-{counters[vrf]}"
        sessions.append(session)
    if len({session["id"] for session in sessions}) != len(sessions):
        raise ValueError("Local discriminator BFD duplikat antar-session.")
    for route in routes:
        route["session"] = bfd_by_key[(route["vrf"], route["family"], route["vlan"], ip_address(route["gateway"]))]["name"]
    for peer in peers:
        if not any(route["vrf"] == peer["vrf"] and route["family"] == peer["family"] and route["length"] == (32 if peer["family"] == 4 else 128) and ip_address(route["prefix"]) == ip_address(peer["peer"]) for route in routes):
            raise ValueError(f"Peer {peer['peer']}: host route pendukung tidak ditemukan.")
    if any((link["vrf"], link["family"]) not in {(peer["vrf"], peer["family"]) for peer in peers} for link in links):
        raise ValueError("Setiap VRF/IP family NP memerlukan BGP Design pada template ini.")
    warnings.append("BFD memakai mode one-arm echo sesuai contoh; satu session per VRF/VLAN/IP family/gateway dan discriminator pertama dari range. Peer cadangan dengan gateway identik tidak diduplikasi.")
    return {"node": node, "links": links, "trunks": trunks, "physical": physical, "loopbacks": loopbacks, "peers": peers, "routes": routes, "sessions": sessions, "warnings": warnings}


def summary(m):
    return {"vrfs": len({link["vrf"] for link in m["links"]}), "subinterfaces": len({link["interface"] for link in m["links"]}), "bfd_sessions": len(m["sessions"]), "static_routes": len(m["routes"]), "bgp_peers": len(m["peers"]), "loopbacks": len(m["loopbacks"])}


def interfaces_for(m):
    return list(dict.fromkeys([*m["physical"], *m["trunks"], *(link["interface"] for link in m["links"]), *(loop["interface"] for loop in m["loopbacks"])]))


def rename_interfaces(m, names):
    originals = interfaces_for(m)
    if not isinstance(names, dict) or set(names) != set(originals):
        raise ValueError("Isi/konfirmasi nama manual untuk semua physical interface, trunk, subinterface, dan loopback.")
    mapping = {}
    for original, entered in names.items():
        if not isinstance(entered, str):
            raise ValueError("Nama interface manual harus teks.")
        chosen = re.sub(r"\s+", "", entered)
        if original in m["physical"]:
            valid = re.fullmatch(r"[A-Za-z0-9-]+[0-9]+/[0-9]+/[0-9]+", chosen)
        elif original in m["trunks"]:
            valid = re.fullmatch(r"Eth-Trunk[0-9]+", chosen)
        elif original.lower().startswith("loopback"):
            valid = re.fullmatch(r"Loopback[0-9]+", chosen, re.I)
            if valid:
                chosen = "Loopback" + str(int(re.search(r"[0-9]+", chosen)[0]))
        else:
            valid = re.fullmatch(r"Eth-Trunk[0-9]+\.[0-9]+", chosen)
        if not valid or len(chosen) > 100:
            raise ValueError(f"{original}: nama interface manual tidak sesuai jenis interface.")
        mapping[original] = chosen
    if len({name.casefold() for name in mapping.values()}) != len(mapping):
        raise ValueError("Nama interface manual tidak boleh duplikat.")
    for link in m["links"]:
        if mapping[link["interface"]].split(".")[0] != mapping[link["trunk"]]:
            raise ValueError(f"{link['interface']}: nama subinterface harus mengikuti nama trunk manual.")
    m["physical"] = {mapping[port]: mapping[trunk] for port, trunk in m["physical"].items()}
    m["trunks"] = {mapping[trunk]: {**config, "ports": tuple(mapping[port] for port in config["ports"])} for trunk, config in m["trunks"].items()}
    for group in (m["links"], m["loopbacks"], m["peers"], m["routes"], m["sessions"]):
        for item in group:
            for key in ("interface", "trunk"):
                if key in item:
                    item[key] = mapping[item[key]]
    return mapping


def inspect_workbook(data: bytes) -> dict:
    sheets, tables = workbook_tables(data)
    nodes = sorted({tables["np"].get(row, "NE Name") for row in tables["np"].records})
    if not nodes or len(nodes) > 100:
        raise ValueError("LLD harus berisi 1–100 node NP.")
    models = [model(tables, node) for node in nodes]
    return {"nodes": nodes, "sheets": [sheet.name for sheet in sheets], "warnings": list(dict.fromkeys(warning for m in models for warning in m["warnings"])),
            "node_summaries": [{"node": m["node"], **summary(m), "physical_interfaces": list(m["physical"])} for m in models], "interfaces": {m["node"]: interfaces_for(m) for m in models}, "template_version": TEMPLATE_VERSION}


def command(action, object_name, **parameters):
    return f"{action} {object_name}:" + ",".join(f'{key}={value}' for key, value in parameters.items()) + ";"


def quoted(value):
    return f'"{value}"'


def validate_cleanup(lines, vrfs, families):
    expected = {"IMPORTROUTE": set(families), "BGPVRFAF": set(families), "BGPVRF": set(vrfs)}
    seen = {key: set() for key in expected}
    ranks = {"IMPORTROUTE": 0, "BGPVRFAF": 1, "BGPVRF": 2}
    prior = 0
    for line in lines:
        match = re.fullmatch(r"RMV (IMPORTROUTE|BGPVRFAF|BGPVRF):(.+);", line)
        if not match:
            raise ValueError("Cleanup hanya menerima RMV IMPORTROUTE/BGPVRFAF/BGPVRF.")
        object_name = match[1]
        if ranks[object_name] < prior:
            raise ValueError("Urutan cleanup harus IMPORTROUTE, BGPVRFAF, lalu BGPVRF.")
        prior = ranks[object_name]
        parameters = {}
        for part in match[2].split(","):
            parameter = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(?:"([A-Za-z0-9_.:/-]+)"|([A-Za-z0-9_.:/-]+))', part.strip())
            if not parameter or parameter[1] in parameters:
                raise ValueError("Parameter cleanup tidak valid/duplikat.")
            parameters[parameter[1]] = parameter[2] or parameter[3]
        allowed = {"VRFNAME"} if object_name == "BGPVRF" else {"VRFNAME", "AFTYPE"} | ({"IMPORTPROTOCOL"} if object_name == "IMPORTROUTE" else set())
        if set(parameters) != allowed:
            raise ValueError(f"Cleanup {object_name}: parameter harus {', '.join(sorted(allowed))}.")
        vrf = parameters["VRFNAME"]
        if vrf not in vrfs:
            raise ValueError("Cleanup tidak boleh menyentuh VRF di luar paket.")
        if object_name == "BGPVRF":
            key = vrf
        else:
            if parameters["AFTYPE"] not in ("ipv4uni", "ipv6uni"):
                raise ValueError("AFTYPE cleanup harus ipv4uni atau ipv6uni.")
            key = vrf, int(parameters["AFTYPE"][3])
            if object_name == "IMPORTROUTE" and parameters["IMPORTPROTOCOL"] != "wlr":
                raise ValueError("Cleanup IMPORTROUTE hanya boleh menghapus wlr paket ini.")
        if key not in expected[object_name] or key in seen[object_name]:
            raise ValueError("Resource cleanup duplikat atau tidak termasuk paket.")
        seen[object_name].add(key)
    if seen != expected:
        raise ValueError("Cleanup belum mencakup seluruh import WLR, BGP AF, dan BGP VRF paket ini.")


def generate_package(data: bytes, options: dict) -> dict:
    if not isinstance(options, dict):
        raise ValueError("Options harus object JSON.")
    allowed = {"node", "extension", "bgp_password", "ebgp_max_hop", "max_load_balance", "baseline_confirmed", "baseline", "bgp_cleanup_commands", "interface_names", "bgp_enabled_before", "bfd_enabled_before", "physical_admin_before"}
    if set(options) - allowed:
        raise ValueError("Opsi generator tidak dikenal: " + ", ".join(sorted(set(options) - allowed)))
    sheets, tables = workbook_tables(data)
    nodes = sorted({tables["np"].get(row, "NE Name") for row in tables["np"].records})
    node = options.get("node") or (nodes[0] if len(nodes) == 1 else "")
    if node not in nodes:
        raise ValueError("Pilih node NP yang tersedia di LLD.")
    if options.get("baseline_confirmed") is not True:
        raise ValueError("Konfirmasi bahwa resource baru, baseline tersimpan, dan sintaks sesuai versi perangkat diperlukan.")
    extension = options.get("extension", "txt")
    if extension not in ("txt", "ini"):
        raise ValueError("Ekstensi harus txt atau ini.")
    password = options.get("bgp_password", "")
    if not isinstance(password, str) or not re.fullmatch(r"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,200}", password):
        raise ValueError("Password BGP wajib diisi; spasi, tanda kutip, koma, titik koma, backslash, dan karakter kontrol tidak didukung.")
    hop = number(options.get("ebgp_max_hop", 10), "EBGP max hop", 1, 255)
    loadbalance = number(options.get("max_load_balance", 2), "Maximum load balance", 1, 64)
    m = model(tables, node)
    interface_mapping = rename_interfaces(m, options.get("interface_names"))
    warnings = m["warnings"][:]
    manual = []
    baseline = options.get("baseline", {})
    if not isinstance(baseline, dict) or set(baseline) - {"bgp_enabled", "bfd_enabled", "physical_interfaces", "bgp_asn"}:
        raise ValueError("Baseline tidak valid.")
    baseline = dict(baseline)
    for alias, field in (("bgp_enabled_before", "bgp_enabled"), ("bfd_enabled_before", "bfd_enabled"), ("physical_admin_before", "physical_interfaces")):
        if alias in options:
            if field in baseline and baseline[field] != options[alias]:
                raise ValueError("Opsi baseline bertentangan.")
            baseline[field] = options[alias]
    for key in ("bgp_enabled", "bfd_enabled"):
        if key in baseline and not isinstance(baseline[key], bool):
            raise ValueError(f"baseline.{key} harus boolean.")
    physical_before = baseline.get("physical_interfaces", {})
    if not isinstance(physical_before, dict) or any(port not in interface_mapping or interface_mapping[port] not in m["physical"] or status not in ("up", "down") for port, status in physical_before.items()):
        raise ValueError("baseline.physical_interfaces harus mapping nama port LLD ke up/down.")
    physical_before = {interface_mapping[port]: status for port, status in physical_before.items()}
    local_as = m["peers"][0]["asn"]
    if baseline.get("bgp_enabled") is True:
        if "bgp_asn" not in baseline:
            manual.append("Pastikan AS BGP existing sama dengan AS lokal LLD sebelum SET BGP.")
        elif number(baseline["bgp_asn"], "Baseline BGP ASN") != local_as:
            raise ValueError("ASN BGP existing berbeda dari LLD. Migrasi AS tidak didukung.")
    cleanup = options.get("bgp_cleanup_commands", "")
    if not isinstance(cleanup, str) or len(cleanup) > 30_000:
        raise ValueError("BGP cleanup commands tidak valid.")
    cleanup_lines = [line.strip() for line in cleanup.splitlines() if line.strip()]
    if any(not re.fullmatch(r'RMV (?:IMPORTROUTE|BGPVRFAF|BGPVRF):[A-Za-z0-9_=",.:/-]+;', line) for line in cleanup_lines):
        raise ValueError("Cleanup hanya menerima baris RMV IMPORTROUTE/BGPVRFAF/BGPVRF MML tervalidasi.")
    vrfs = list(dict.fromkeys(link["vrf"] for link in m["links"]))
    families = list(dict.fromkeys((link["vrf"], link["family"]) for link in m["links"]))
    if cleanup_lines:
        validate_cleanup(cleanup_lines, vrfs, families)
    interfaces = list(dict.fromkeys(link["interface"] for link in m["links"]))
    prep_common = [f"// Node: {node}", f"// Template: {TEMPLATE_VERSION}", "// Simpan hasil precheck/baseline. Semua ADD pada paket ini harus resource BARU.", "// STOP bila resource sudah ada, parameter berbeda, atau command tidak didukung versi perangkat.", "LST INTERFACE:;", "LST IFIPV4ADDRESS:;", "LST IFIPV6ADDRESS:;", "LST IPBINDVPN:;"]
    static = {key: [] for key in ("preparation", "execution", "verification", "rollback")}
    bgp = {key: [] for key in static}
    static["preparation"] = prep_common + ["// Catat status global BFD dan admin-state setiap physical port dari baseline perangkat.", "DSP BFDSESSION:;"]
    for vrf, family in families:
        static["preparation"].append(command("DSP", "SRROUTE" if family == 4 else "SRROUTE6", AFTYPE="ipv4unicast" if family == 4 else "ipv6unicast", VRFNAME=quoted(vrf)))
    execute = static["execution"]
    execute.append("// Jalankan execution paket 01, verifikasi, kemudian execution paket 02.")
    for vrf in vrfs:
        execute.append(command("ADD", "L3VPNINST", VRFNAME=quoted(vrf)))
    for vrf, family in families:
        execute.append(command("ADD", "VPNINSTAF", VRFNAME=quoted(vrf), AFTYPE=f"ipv{family}uni"))
    for port in m["physical"]:
        execute.append(command("MOD", "INTERFACE", IFNAME=quoted(port), IFADMINSTATUS="up"))
    for trunk, config in m["trunks"].items():
        execute.append(command("ADD", "INTERFACE", IFNAME=quoted(trunk)))
        execute.append(command("MOD", "TRUNKIF", IFNAME=quoted(trunk), WORKMODE="Lacp", LEASTACTLINKNUM=config["least"]))
        for port in config["ports"]:
            execute.append(command("ADD", "TRUNKMEMBER", TRUNKIFNAME=quoted(trunk), MEMBERIFNAME=quoted(port)))
    for iface in interfaces:
        link = next(link for link in m["links"] if link["interface"] == iface)
        execute += [command("ADD", "INTERFACE", IFNAME=quoted(iface)), command("ADD", "IPBINDVPN", IFNAME=quoted(iface), VRFNAME=quoted(link["vrf"])), command("ADD", "ETHSUBIF", IFNAME=quoted(iface), VLANTYPEVID=link["vlan"])]
    for link in m["links"]:
        if link["family"] == 4:
            execute.append(command("ADD", "IFIPV4ADDRESS", IFNAME=quoted(link["interface"]), IFIPADDR=quoted(link["local"]), SUBNETMASK=quoted(str(ip_network(f"0.0.0.0/{link['length']}").netmask))))
        else:
            execute += [command("SET", "IFIPV6ENABLE", IFNAME=quoted(link["interface"]), ENABLEFLAG="TRUE"), command("ADD", "IFIPV6ADDRESS", IFNAME=quoted(link["interface"]), IPV6ADDRESS=quoted(link["local"]), PREFIXLEN=link["length"])]
    execute.append("SET BFD:BFDENABLE=TRUE;")
    for session in m["sessions"]:
        family = session["family"]
        params = {"SESSNAME": quoted(session["name"]), "ADDRTYPE": f"IPv{family}", f"CREATETYPE{family}": "SESS_STATIC", "ONEARMECHO" if family == 4 else "ONEARMECHO6": "TRUE", f"DESTADDR{family}": quoted(session["gateway"]), "LINKTYPE": "IP", "DETECTMULTI": session["multi"], "VRFNAME": quoted(session["vrf"]), "MINECHORXINT": session["rx"], "LOCALDISCR": session["id"], f"SRCADDR{family}": quoted(session["local"]), "IFNAME": quoted(session["interface"])}
        execute.append(command("ADD", "BFDSESSION", **params))
    def route_command(route, action):
        params = {"VRFNAME": quoted(route["vrf"]), "AFTYPE": f"ipv{route['family']}unicast", "PREFIX": quoted(route["prefix"]), "MASKLENGTH": route["length"]}
        if route["family"] == 4:
            params["DESTVRFNAME"] = quoted(route["vrf"])
        params.update(NEXTHOP=quoted(route["gateway"]), IFNAME=quoted(route["interface"]))
        if action == "ADD":
            params["SESSIONNAME"] = quoted(route["session"])
        return command(action, "SRROUTE" if route["family"] == 4 else "SRROUTE6", **params)
    execute.extend(route_command(route, "ADD") for route in m["routes"])
    static["verification"] = prep_common[4:] + ["DSP BFDSESSION:;"] + [command("DSP", "SRROUTE" if family == 4 else "SRROUTE6", AFTYPE=f"ipv{family}unicast", VRFNAME=quoted(vrf)) for vrf, family in families] + ["// Lulus: seluruh trunk/member sesuai LLD, BFD UP, dan route terpasang melalui interface/next-hop yang benar.", "// STOP dan jalankan rollback jika hasil tidak sesuai. Jangan lanjut BGP."]
    rollback = static["rollback"]
    rollback.append("// Jalankan rollback paket 02 hingga selesai SEBELUM rollback paket 01.")
    rollback.extend(route_command(route, "RMV") for route in reversed(m["routes"]))
    rollback.extend(command("RMV", "BFDSESSION", SESSNAME=quoted(session["name"])) for session in reversed(m["sessions"]))
    for link in reversed(m["links"]):
        if link["family"] == 4:
            rollback.append(command("RMV", "IFIPV4ADDRESS", IFNAME=quoted(link["interface"]), IFIPADDR=quoted(link["local"]), SUBNETMASK=quoted(str(ip_network(f"0.0.0.0/{link['length']}").netmask))))
        else:
            rollback += [command("RMV", "IFIPV6ADDRESS", IFNAME=quoted(link["interface"]), IPV6ADDRESS=quoted(link["local"]), PREFIXLEN=link["length"]), command("SET", "IFIPV6ENABLE", IFNAME=quoted(link["interface"]), ENABLEFLAG="FALSE")]
    for iface in reversed(interfaces):
        link = next(link for link in m["links"] if link["interface"] == iface)
        rollback += [command("RMV", "IPBINDVPN", IFNAME=quoted(iface), VRFNAME=quoted(link["vrf"])), command("RMV", "ETHSUBIF", IFNAME=quoted(iface), VLANTYPEVID=link["vlan"]), command("RMV", "INTERFACE", IFNAME=quoted(iface))]
    for trunk, config in reversed(m["trunks"].items()):
        rollback.extend(command("RMV", "TRUNKMEMBER", TRUNKIFNAME=quoted(trunk), MEMBERIFNAME=quoted(port)) for port in reversed(config["ports"]))
        rollback.append(command("RMV", "INTERFACE", IFNAME=quoted(trunk)))
    for vrf, family in reversed(families):
        rollback.append(command("RMV", "VPNINSTAF", VRFNAME=quoted(vrf), AFTYPE=f"ipv{family}uni"))
    rollback.extend(command("RMV", "L3VPNINST", VRFNAME=quoted(vrf)) for vrf in reversed(vrfs))
    for port in reversed(m["physical"]):
        if port in physical_before:
            rollback.append(command("MOD", "INTERFACE", IFNAME=quoted(port), IFADMINSTATUS=physical_before[port]))
        else:
            manual.append(f"Pulihkan admin-state {port} ke hasil baseline.")
    if "bfd_enabled" in baseline:
        rollback.append(f"SET BFD:BFDENABLE={'TRUE' if baseline['bfd_enabled'] else 'FALSE'};")
    else:
        manual.append("Pulihkan status global BFD sesuai baseline; jangan menonaktifkan BFD layanan existing.")
    bgp["preparation"] = prep_common + ["// Prasyarat: execution + verification paket 01 lulus; semua peer memiliki host route dan BFD UP.", "// Catat status global BGP/AS dan pastikan semua BGP VRF/AF/import baru.", "LST BGPPEER:;", "DSP BGPPEERINFO:;"]
    execute = bgp["execution"]
    for loop in m["loopbacks"]:
        execute += [command("ADD", "INTERFACE", IFNAME=quoted(loop["interface"])), command("ADD", "IPBINDVPN", VRFNAME=quoted(loop["vrf"]), IFNAME=quoted(loop["interface"]))]
        if loop["family"] == 4:
            execute.append(command("ADD", "IFIPV4ADDRESS", IFNAME=quoted(loop["interface"]), IFIPADDR=quoted(loop["local"]), SUBNETMASK=quoted("255.255.255.255"), ADDRTYPE="main"))
        else:
            execute += [command("SET", "IFIPV6ENABLE", IFNAME=quoted(loop["interface"]), ENABLEFLAG="TRUE", MTU=1500, AUTOLINKLOCAL="FALSE"), command("ADD", "IFIPV6ADDRESS", IFNAME=quoted(loop["interface"]), IPV6ADDRESS=quoted(loop["local"]), PREFIXLEN=128, ADDRTYPE="global", IDGENTYPE="none")]
    execute.append(command("SET", "BGP", BGPENABLE="TRUE", ASNUM=quoted(local_as)))
    for vrf in vrfs:
        peer = next(peer for peer in m["peers"] if peer["vrf"] == vrf)
        execute.append(command("ADD", "BGPVRF", VRFNAME=quoted(vrf), ROUTERID=quoted(peer["router_id"]), DEFAULTAFTYPE="noaf", VRFRIDAUTOSEL="FALSE"))
    for vrf, family in families:
        peer = next(peer for peer in m["peers"] if peer["vrf"] == vrf and peer["family"] == family)
        execute.append(command("ADD", "BGPVRFAF", VRFNAME=quoted(vrf), AFTYPE=f"ipv{family}uni", MAXIMUMLOADBALANCE=loadbalance if peer["loadbalance"] else 1))
    for peer in m["peers"]:
        params = {"VRFNAME": quoted(peer["vrf"]), "ADDRESSTYPE": f"ipv{peer['family']}", "PEERADDR" if peer["family"] == 4 else "PEERADDRV6": quoted(peer["peer"]), "REMOTEAS": quoted(peer["remote_as"]), "LOCALIFADDR": quoted(peer["local"]), "LOCALIFNAME": quoted(peer["interface"]), "EBGPMAXHOP": hop, "PSWDTYPE": "cipher", "PSWDCIPHERTEXT": quoted(password)}
        execute.append(command("ADD", "BGPPEER", **params))
    execute.extend(command("ADD", "IMPORTROUTE", VRFNAME=quoted(vrf), AFTYPE=f"ipv{family}uni", IMPORTPROTOCOL="wlr", MEDENABLE="FALSE") for vrf, family in families)
    bgp["verification"] = prep_common[4:] + ["LST BGPPEER:;", "DSP BGPPEERINFO:;", f"// Lulus: {len(m['peers'])} peer Established, local/remote AS + source interface sesuai LLD, dan route yang diharapkan terlihat.", "// Bandingkan hasil terhadap baseline; STOP bila ada dampak pada layanan existing."]
    rollback = bgp["rollback"]
    rollback.append("// Hanya resource BARU yang dibuat oleh paket ini. Selesaikan sebelum rollback paket 01.")
    rollback.extend(command("RMV", "BGPPEER", **{"VRFNAME": quoted(peer["vrf"]), "ADDRESSTYPE": f"ipv{peer['family']}", "PEERADDR" if peer["family"] == 4 else "PEERADDRV6": quoted(peer["peer"])}) for peer in reversed(m["peers"]))
    if cleanup_lines:
        rollback += ["// Cleanup MML yang disediakan dan divalidasi operator (urutan import -> AF -> VRF)."] + cleanup_lines
    else:
        manual.append("Hapus import WLR, BGP AF, lalu BGP VRF baru menggunakan MML yang tervalidasi untuk versi perangkat; syntax inverse tidak tersedia pada contoh. Isi bgp_cleanup_commands sebelum paket dinyatakan lengkap.")
        rollback.append("// STOP: hapus import WLR, BGP AF, lalu BGP VRF baru dengan MML tervalidasi sebelum melepas interface/VRF.")
    for loop in reversed(m["loopbacks"]):
        if loop["family"] == 4:
            rollback.append(command("RMV", "IFIPV4ADDRESS", IFNAME=quoted(loop["interface"]), IFIPADDR=quoted(loop["local"]), SUBNETMASK=quoted("255.255.255.255")))
        else:
            rollback += [command("RMV", "IFIPV6ADDRESS", IFNAME=quoted(loop["interface"]), IPV6ADDRESS=quoted(loop["local"]), PREFIXLEN=128), command("SET", "IFIPV6ENABLE", IFNAME=quoted(loop["interface"]), ENABLEFLAG="FALSE")]
        rollback += [command("RMV", "IPBINDVPN", VRFNAME=quoted(loop["vrf"]), IFNAME=quoted(loop["interface"])), command("RMV", "INTERFACE", IFNAME=quoted(loop["interface"]))]
    if "bgp_enabled" in baseline:
        if baseline["bgp_enabled"] is False:
            rollback.append("SET BGP:BGPENABLE=FALSE;")
    else:
        manual.append("Pulihkan status global BGP sesuai baseline; jangan menonaktifkan BGP layanan existing.")
    warnings.append("Template mengikuti MML contoh, bukan VRP CLI. Konfirmasi kompatibilitas perintah dengan produk/release perangkat sebelum eksekusi.")
    if manual:
        warnings.append("Paket masih memerlukan baseline/cleanup operator; lihat daftar langkah manual. Jangan mengeksekusi seluruh berkas sekaligus.")
        for sections in (static, bgp):
            sections["preparation"] += ["// REVIEW REQUIRED: lengkapi langkah berikut sebelum eksekusi."] + [f"// {step}" for step in manual]
    files = []
    for index, (label, sections) in enumerate((("Static Routing+BFD Networking (IPv4v6)", static), ("BGP over Static Routing+BFD Networking (IPv4v6)", bgp)), 1):
        strings = {stage: "\r\n".join(lines) + "\r\n" for stage, lines in sections.items()}
        content = "\r\n".join(f"////////// {stage.upper()} on {node}\r\n{value}" for stage, value in strings.items())
        files.append({"name": f"{index:02d} {node} {label}.{extension}", "stage": "static-bfd" if index == 1 else "bgp", "content": content, "sections": strings})
    return {"node": node, "warnings": warnings, "summary": summary(m), "files": files, "template_version": TEMPLATE_VERSION, "source_sha256": sha256(data).hexdigest(), "execution_order": [files[0]["name"], files[1]["name"]], "rollback_order": [files[1]["name"], files[0]["name"]], "manual_steps": manual, "readiness": "review_required" if manual else "baseline_supplied", "requires_review": bool(manual)}
